"use client";

/* v1.307.0 - ATTENDANCE REPORTS, ATTENDANCE WORKSPACE 4.0 (reference image 6).
   Attendance-specific only: the month reconciled, one row a person, from
   GET /staff/attendance/verification - the engine where every scheduled
   working day lands in exactly one bucket (worked, leave or absent) and a
   row that does not add up says so. Rest days and holidays are not working
   days; today is not counted before it is over (A-1); late is after the
   start plus the grace (A-5, from 16-11-2026).

   Payroll reads verified attendance and approved overtime itself - there is
   no second "push" path. Export: the report as CSV, and the month's punches
   in the payroll layout (the existing /attendance/export). Task reports are
   in Tasks; nothing operational is recreated here. Nothing here writes. */

import { Fragment, useEffect, useMemo, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows, StaleHint } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { downloadCsv } from "@/lib/csv";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { hm, type DayRegister } from "./attendance-shared";
import css from "./attendance4.module.css";

type Row = { user_id: number; name: string; position: string | null; role: string; scheduled: number; worked: number; leave_total: number; absent: number; late: number; no_clock_out: number; partial_review_dates: string[]; scheduled_minutes: number; worked_minutes: number; balances: boolean;
  absent_dates?: string[]; leave_dates?: { d: string; type: string }[]; open_dates?: string[] };
/* the figures are the filter (carried from the retired verification card, v1.84.1 -
   the CEO: "pill above there should clickable to get the data") */
type Pill = "" | "late" | "absent" | "leave" | "open" | "exceptions";
type Verification = { month: string; days: number; staff: Row[] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shift = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const exceptionOf = (r: Row) => !r.balances || r.no_clock_out > 0 || r.partial_review_dates.length > 0;

export function AttendanceReports({ canExport }: { canExport: boolean }) {
  const thisMonth = mytToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [dept, setDept] = useState("");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const v = useCachedApi<Verification>(`/staff/attendance/verification?month=${month}`, true, ["attendance"]);
  const day = useCachedApi<DayRegister>(`/staff/attendance/day?date=${mytToday()}`, true, ["attendance"]);
  const deptOf = useMemo(() => new Map((day.data?.staff ?? []).map((p) => [p.id, p.department || p.position || ""])), [day.data]);
  const all = v.data?.staff ?? [];
  const depts = [...new Set(all.map((r) => deptOf.get(r.user_id) || r.position || "").filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => (!dept || (deptOf.get(r.user_id) || r.position) === dept) && (!who || String(r.user_id) === who) && (!needle || r.name.toLowerCase().includes(needle)));
  const [pill, setPill] = useState<Pill>("");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const togglePill = (k: Pill) => setPill(pill === k ? "" : k);
  /* ONE definition of "the rows on screen", read by the table, the cards AND the export */
  const shown = (): Row[] => rows.filter((r) => !pill
    || (pill === "late" && r.late > 0) || (pill === "absent" && r.absent > 0) || (pill === "leave" && r.leave_total > 0)
    || (pill === "open" && r.no_clock_out > 0) || (pill === "exceptions" && exceptionOf(r)));
  /* filtering to a thing opens its dates */
  const showDates = pill === "leave" || pill === "absent" || pill === "open" || pill === "exceptions";
  const datesOf = (r: Row) => [
    (r.absent_dates ?? []).length > 0 ? `${L("Absent", "Tidak hadir")}: ${(r.absent_dates ?? []).map(dmy).join(" · ")}` : "",
    (r.leave_dates ?? []).length > 0 ? `${L("Leave", "Cuti")}: ${(r.leave_dates ?? []).map((x) => dmy(x.d)).join(" · ")}` : "",
    (r.open_dates ?? []).length > 0 ? `${L("No clock-out", "Tiada keluar")}: ${(r.open_dates ?? []).map(dmy).join(" · ")}` : "",
    r.partial_review_dates.length > 0 ? `${L("Partial leave to review", "Cuti separa untuk disemak")}: ${r.partial_review_dates.map(dmy).join(" · ")}` : "",
  ].filter(Boolean);
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const scheduled = sum("scheduled"), worked = sum("worked"), late = sum("late"), absent = sum("absent"), leave = sum("leave_total");
  const workedMin = sum("worked_minutes");
  const exceptions = rows.filter(exceptionOf).length;
  const pct = (n: number) => (scheduled > 0 ? Math.round((n / scheduled) * 100) : 0);

  /* the trend: this month and the five before, worked against scheduled hours */
  const [trend, setTrend] = useState<{ month: string; points: { m: string; worked: number; sched: number }[] } | null>(null);
  useEffect(() => {
    let live = true;
    const months = Array.from({ length: 6 }, (_, i) => shift(month, i - 5));
    void Promise.all(months.map((m) => api<Verification>(`/staff/attendance/verification?month=${m}`))).then((rs) => {
      if (!live) return;
      setTrend({ month, points: rs.map((r, i) => ({ m: months[i]!, worked: (r.data?.staff ?? []).reduce((n, x) => n + x.worked_minutes, 0), sched: (r.data?.staff ?? []).reduce((n, x) => n + x.scheduled_minutes, 0) })) });
    });
    return () => { live = false; };
  }, [month]);
  const pts = trend && trend.month === month ? trend.points : null;
  const max = pts ? Math.max(1, ...pts.map((p) => Math.max(p.worked, p.sched))) : 1;

  const exportCsv = () => {
    const list = shown();
    downloadCsv(`attendance-report-${month}${pill ? `-${pill}` : ""}.csv`, [
      [L("Staff", "Kakitangan"), L("Department", "Jabatan"), L("Scheduled", "Dijadual"), L("Worked", "Bekerja"), L("Late", "Lewat"), L("Absent", "Tidak hadir"), L("Leave", "Cuti"), L("No clock-out", "Tiada keluar"), L("Hours (verified)", "Jam (disahkan)"), L("Status", "Status"),
        L("Absent dates", "Tarikh tidak hadir"), L("Leave dates", "Tarikh cuti"), L("No clock-out dates", "Tarikh tiada keluar"), L("Partial leave dates", "Tarikh cuti separa")],
      ...list.map((r) => [r.name, deptOf.get(r.user_id) || r.position || "", r.scheduled, r.worked, r.late, r.absent, r.leave_total, r.no_clock_out, (r.worked_minutes / 60).toFixed(2), exceptionOf(r) ? "Has exception" : "Complete",
        (r.absent_dates ?? []).join(" "), (r.leave_dates ?? []).map((x) => `${x.d}:${x.type}`).join(" "), (r.open_dates ?? []).join(" "), r.partial_review_dates.join(" ")]),
    ]);
  };
  return (
    <>
      <section className={card} aria-label={L("Attendance reports", "Laporan kehadiran")}>
        <div className={css.head}>
          <div className={css.headText}>
            <p className={css.title}>{L("Attendance Reports", "Laporan Kehadiran")}</p>
            <p className={css.sub}>{L("Attendance verification and the monthly summary payroll works from.", "Pengesahan kehadiran dan ringkasan bulanan yang digunakan gaji.")}</p>
          </div>
          <span className={css.introRight}>
            <button type="button" className={btnSm} onClick={exportCsv} data-testid="rep-export"><AppIcon name="download" />{L("Export report (CSV)", "Eksport laporan (CSV)")}</button>
            {canExport && <a className={btnSm} href={`/api/v1/staff/attendance/export?month=${month}`}><AppIcon name="download" />{L("Punches for Payroll (CSV)", "Ketukan untuk Gaji (CSV)")}</a>}
          </span>
        </div>
        <div className={css.filters}>
          <select className={selectClassSm} value="monthly" aria-label={L("Report type", "Jenis laporan")} disabled><option value="monthly">{L("Monthly attendance summary", "Ringkasan kehadiran bulanan")}</option></select>
          <select className={selectClassSm} value={month} onChange={(e) => setMonth(e.target.value)} aria-label={L("Period", "Tempoh")} data-testid="rep-month">
            {Array.from({ length: 12 }, (_, i) => shift(thisMonth, -i)).map((m) => <option key={m} value={m}>{`${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`}</option>)}
          </select>
          <select className={selectClassSm} value={dept} onChange={(e) => setDept(e.target.value)} aria-label={L("Team / Department", "Pasukan / Jabatan")}>
            <option value="">{L("All departments", "Semua jabatan")}</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={selectClassSm} value={who} onChange={(e) => setWho(e.target.value)} aria-label={L("Employee", "Pekerja")}>
            <option value="">{L("All staff", "Semua kakitangan")}</option>{all.map((r) => <option key={r.user_id} value={r.user_id}>{properName(r.name)}</option>)}
          </select>
        </div>
      </section>
      <KpiRow label={L("The month", "Bulan ini")}>
        <KpiTile icon="date" tone="blue" label={L("Scheduled Days", "Hari Dijadualkan")} value={scheduled} busy={!v.data} sub={L(`${rows.length} staff · days that have happened`, `${rows.length} kakitangan · hari yang telah berlaku`)} />
        <KpiTile icon="time" tone="green" label={L("Verified Working Hours", "Jam Bekerja Disahkan")} value={hm(workedMin)} busy={!v.data} sub={rows.length ? L(`Avg ${hm(Math.round(workedMin / rows.length))} / staff`, `Purata ${hm(Math.round(workedMin / rows.length))} / orang`) : undefined} />
        <KpiTile icon="warning" tone="gold" label={L("Late Arrivals", "Lewat Tiba")} value={late} busy={!v.data} onClick={() => togglePill("late")} pressed={pill === "late"} sub={L(`${pct(late)}% of workdays`, `${pct(late)}% hari bekerja`)} />
        <KpiTile icon="error" tone="red" label={L("Absences", "Ketidakhadiran")} value={absent} busy={!v.data} onClick={() => togglePill("absent")} pressed={pill === "absent"} sub={L(`${pct(absent)}% of workdays`, `${pct(absent)}% hari bekerja`)} />
        <KpiTile icon="holiday" tone="blue" label={L("On Leave", "Bercuti")} value={leave} busy={!v.data} onClick={() => togglePill("leave")} pressed={pill === "leave"} sub={L(`${pct(leave)}% of workdays`, `${pct(leave)}% hari bekerja`)} />
        <KpiTile icon="verify" tone="navy" label={L("Exceptions", "Pengecualian")} value={exceptions} busy={!v.data} sub={L(`Rows to review · ${sum("no_clock_out")} no clock-out`, `Baris untuk disemak · ${sum("no_clock_out")} tiada keluar`)} onClick={() => togglePill("exceptions")} pressed={pill === "exceptions"} />
      </KpiRow>
      <div className={css.split}>
        <section className={card} aria-label={L("Attendance report", "Laporan kehadiran")} data-testid="rep-table">
          <div className={css.head}>
            <div className={css.headText}>
              <p className={css.title}>{L(`Attendance Report — ${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`, `Laporan Kehadiran — ${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`)}</p>
              <p className={css.sub}>{L("Every scheduled day lands in one bucket: worked + leave + absent = scheduled. A row that does not add up is an exception.", "Setiap hari dijadualkan masuk satu kumpulan: bekerja + cuti + tidak hadir = dijadualkan. Baris yang tidak seimbang ialah pengecualian.")}</p>
            </div>
            <input type="search" className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff name…", "Cari nama kakitangan…")} aria-label={L("Search", "Cari")} />
          </div>
          <StaleHint show={v.stale} />
          {pill && <p className={css.dayNote}>{L("Filtered by the figure above - press it again for everyone. The CSV follows the filter.", "Ditapis mengikut angka di atas - tekan sekali lagi untuk semua. CSV mengikut tapisan.")} <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={() => setPill("")}>{L("Show everyone", "Tunjuk semua")}</button></p>}
          {!v.data ? <SkelRows rows={6} /> : shown().length === 0 ? <p className={css.empty}>{L("No staff for this period.", "Tiada kakitangan untuk tempoh ini.")}</p> : (
            <>
              <div className={`${css.tableWrap} erp-desktop-only`}>
                <table className={css.table}>
                  <thead><tr><th>{L("No.", "No.")}</th><th>{L("Staff", "Kakitangan")}</th><th>{L("Department", "Jabatan")}</th><th className={css.num}>{L("Scheduled", "Dijadual")}</th><th className={css.num}>{L("Worked", "Bekerja")}</th><th className={css.num}>{L("Late", "Lewat")}</th><th className={css.num}>{L("Absent", "Tidak hadir")}</th><th className={css.num}>{L("Leave", "Cuti")}</th><th className={css.num}>{L("Hours (actual)", "Jam (sebenar)")}</th><th>{L("Status", "Status")}</th></tr></thead>
                  <tbody>
                    {shown().map((r, i) => {
                      const dates = datesOf(r);
                      const opened = (showDates || openRow === r.user_id) && dates.length > 0;
                      return (
                        <Fragment key={r.user_id}>
                          <tr data-testid="rep-row">
                            <td>{i + 1}</td><td><span className={css.who}><strong>{properName(r.name)}</strong><span>{r.position ?? ""}</span></span></td>
                            <td className={css.muted}>{deptOf.get(r.user_id) || "—"}</td>
                            <td className={css.num}>{r.scheduled}</td><td className={css.num}>{r.worked}</td><td className={css.num}>{r.late}</td><td className={css.num}>{r.absent}</td><td className={css.num}>{r.leave_total}</td>
                            <td className={css.num}>{hm(r.worked_minutes)}{r.no_clock_out > 0 && <span className={css.cardMeta}>{L(`${r.no_clock_out} no clock-out`, `${r.no_clock_out} tiada keluar`)}</span>}</td>
                            <td>
                              {dates.length > 0 ? (
                                <button type="button" className={css.cellBtn} aria-expanded={opened} onClick={() => setOpenRow(openRow === r.user_id ? null : r.user_id)}>
                                  <span className={exceptionOf(r) ? chipSmWarn : chipSmSuccess}>{exceptionOf(r) ? L("Has exception", "Ada pengecualian") : L("Complete", "Lengkap")}</span>
                                </button>
                              ) : <span className={exceptionOf(r) ? chipSmWarn : chipSmSuccess}>{exceptionOf(r) ? L("Has exception", "Ada pengecualian") : L("Complete", "Lengkap")}</span>}
                            </td>
                          </tr>
                          {(opened || !r.balances) && (
                            <tr><td /><td colSpan={9} className={css.muted}>
                              {!r.balances && <strong>{L("This row does not add up: worked + leave + absent is not the scheduled days. ", "Baris ini tidak seimbang: bekerja + cuti + tidak hadir bukan hari dijadualkan. ")}</strong>}
                              {opened && dates.join("  ·  ")}
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                    <tr><td /><td><strong>{L(`Total (${rows.length} staff)`, `Jumlah (${rows.length} orang)`)}</strong></td><td /><td className={css.num}><strong>{scheduled}</strong></td><td className={css.num}><strong>{worked}</strong></td><td className={css.num}><strong>{late}</strong></td><td className={css.num}><strong>{absent}</strong></td><td className={css.num}><strong>{leave}</strong></td><td className={css.num}><strong>{hm(workedMin)}</strong></td><td /></tr>
                  </tbody>
                </table>
              </div>
              <ul className={`${css.cards} erp-phone-only`}>
                {shown().map((r) => (
                  <li key={r.user_id} className={css.cardRow}>
                    <span className={css.cardTop}><strong>{properName(r.name)}</strong><span className={exceptionOf(r) ? chipSmWarn : chipSmSuccess}>{exceptionOf(r) ? L("Has exception", "Ada pengecualian") : L("Complete", "Lengkap")}</span></span>
                    <span className={css.cardMeta}><span>{L(`${r.worked}/${r.scheduled} days`, `${r.worked}/${r.scheduled} hari`)}</span><span>{L(`late ${r.late}`, `lewat ${r.late}`)}</span><span>{L(`absent ${r.absent}`, `tidak hadir ${r.absent}`)}</span><span>{L(`leave ${r.leave_total}`, `cuti ${r.leave_total}`)}</span><span>{hm(r.worked_minutes)}</span>{r.no_clock_out > 0 && <span>{L(`${r.no_clock_out} no clock-out`, `${r.no_clock_out} tiada keluar`)}</span>}</span>
                    {!r.balances && <span className={css.cardMeta}><strong>{L("This row does not add up.", "Baris ini tidak seimbang.")}</strong></span>}
                    {showDates && datesOf(r).map((t) => <span key={t} className={css.cardMeta}>{t}</span>)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <div className={css.body}>
          <section className={card} aria-label={L("Attendance trend", "Trend kehadiran")} data-testid="rep-trend">
            <p className={css.title}>{L("Attendance Trend", "Trend Kehadiran")}</p>
            <p className={css.sub}>{L("Verified working hours against scheduled hours, the last six months.", "Jam bekerja disahkan berbanding jam dijadualkan, enam bulan terakhir.")}</p>
            {!pts ? <SkelRows rows={3} /> : (
              <div className={css.trend}>
                {pts.map((p) => (
                  <div key={p.m} className={css.bar} title={L(`${hm(p.worked)} worked of ${hm(p.sched)} scheduled`, `${hm(p.worked)} bekerja daripada ${hm(p.sched)} dijadualkan`)}>
                    <span className={css.barLabel}>{Math.round(p.worked / 60)}h</span>
                    <span className={`${css.barFill} ${p.m === month ? css.barNow : ""}`} style={{ height: `${Math.round((p.worked / max) * 100)}%` }} />
                    <span>{MON[Number(p.m.slice(5, 7)) - 1]}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Attendance breakdown", "Pecahan kehadiran")}>
            <p className={css.title}>{L("Attendance Breakdown", "Pecahan Kehadiran")}</p>
            {!v.data ? <SkelRows rows={3} /> : (
              <Donut size={120} centerLabel={String(scheduled)} centerSub={L("workdays", "hari bekerja")} slices={[
                { label: L("Worked", "Bekerja"), value: Math.max(0, worked - late), color: "var(--success)" },
                { label: L("Late (days)", "Lewat (hari)"), value: late, color: "var(--warning)" },
                { label: L("On leave", "Bercuti"), value: leave, color: "var(--info)" },
                { label: L("Absent", "Tidak hadir"), value: absent, color: "var(--danger)" },
              ]} />
            )}
          </section>
        </div>
      </div>
      <p className={css.boundary}><strong>{L("Payroll", "Gaji")}</strong>{L(" reads verified attendance, approved leave and approved overtime itself - there is no separate push. Only approved overtime is ever paid; nothing here changes a payroll record or a released payslip.", " membaca kehadiran disahkan, cuti diluluskan dan OT diluluskan sendiri - tiada penghantaran berasingan. Hanya OT yang diluluskan dibayar; tiada apa di sini mengubah rekod gaji atau slip gaji yang dikeluarkan.")}</p>
    </>
  );
}
