"use client";

/**
 * Attendance verification — v1.84.0.
 *
 * CEO, 03-09-2026: *"attendance verification should move to Attendance and
 * make it minimalist interface, then it is should include for the staff which
 * is on leave, or medical leave. full report is require and a must!"*
 *
 * WHAT IT REPLACES. The old card lived on the HR tab and printed every punch
 * in the month — one row per ketukan, hundreds of them, each with a Shift
 * check badge. Nothing added up, and nothing could: it was a log, not a
 * report. Worse, somebody on medical leave for a week simply had NO ROWS,
 * which on that screen is indistinguishable from somebody who never came in.
 * Telling those two apart is the entire job of a verification report.
 *
 * THE PROPERTY THAT MAKES THIS ONE. Every scheduled working day lands in
 * exactly one bucket, and the buckets sum to the scheduled days:
 *
 *     worked + leave + absent = scheduled
 *
 * A row where that fails carries a question, and the row says so — a
 * reconciliation nobody can see is a reconciliation nobody does. Rest days
 * and public holidays are counted separately and are NOT scheduled days:
 * nobody is absent from a day they were never due to work, and which days
 * those are comes from that person's own split-shift pattern rather than an
 * assumption about Saturdays.
 *
 * MINIMALIST means one row per PERSON, not per punch — nine rows instead of
 * six hundred — with the day-level detail one click away on the row it
 * belongs to. The CSV carries the same figures plus the dates behind them,
 * because "full report is require and a must".
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { card, th, td } from "@/lib/ui-styles";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn } from "@/components/ui/row-button";
import { properName } from "@/lib/names";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmy } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface VRow {
  user_id: number;
  name: string;
  email: string | null;
  employee_id: string | null;
  position: string | null;
  role: string;
  employment_status: string | null;
  scheduled: number;
  worked: number;
  leave_total: number;
  leave_by_type: Record<string, number>;
  absent: number;
  rest_days: number;
  public_holidays: number;
  late: number;
  early_out: number;
  short_days: number;
  assigned_days: number;
  scheduled_minutes: number;
  worked_minutes: number;
  absent_dates: string[];
  leave_dates: { d: string; type: string }[];
  balances: boolean;
}

const LEAVE_LABEL: Record<string, [string, string]> = {
  annual: ["Annual", "Tahunan"],
  medical: ["Medical", "Perubatan"],
  emergency: ["Emergency", "Kecemasan"],
  unpaid: ["Unpaid", "Tanpa gaji"],
  replacement: ["Replacement", "Gantian"],
};
const leaveLabel = (t: string) => {
  const hit = LEAVE_LABEL[t];
  return hit ? L(hit[0], hit[1]) : t;
};

/** "7h30" — short enough to sit in a narrow column without wrapping. */
const hm = (mins: number) =>
  mins <= 0 ? "—" : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;

export function VerificationCard() {
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<VRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoaded(false);
    setErr("");
    const r = await api<{ staff: VRow[]; error?: { message?: string } }>(
      `/staff/attendance/verification?month=${month}`,
    );
    if (r.ok && r.data) setRows(r.data.staff ?? []);
    else setErr(r.data?.error?.message ?? L("Could not load the report.", "Laporan tidak dapat dimuatkan."));
    setLoaded(true);
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  /* The one figure a reconciliation is for: how many rows do not add up. */
  const unbalanced = rows.filter((r) => !r.balances).length;
  const totalAbsent = rows.reduce((n, r) => n + r.absent, 0);
  const totalLeave = rows.reduce((n, r) => n + r.leave_total, 0);

  const exportCsv = () => {
    /* The full report: the summary AND the dates behind it, because a figure
       somebody has to come back and ask about is half a report. */
    downloadCsv(`attendance-verification-${month}`, [
      [`# ${L("Attendance verification", "Pengesahan kehadiran")} — ${month}`],
      [`# ${L("Generated", "Dijana")} ${csvStampMyt()}`],
      [`# ${L("worked + leave + absent = scheduled working days", "bekerja + cuti + tidak hadir = hari bekerja berjadual")}`],
      [],
      [
        L("Employee ID", "ID pekerja"), L("Staff", "Kakitangan"), L("Email", "E-mel"),
        L("Position", "Jawatan"), L("Status", "Status"),
        L("Scheduled days", "Hari berjadual"), L("Worked", "Bekerja"),
        L("Leave (total)", "Cuti (jumlah)"),
        L("Annual", "Tahunan"), L("Medical", "Perubatan"), L("Emergency", "Kecemasan"),
        L("Unpaid", "Tanpa gaji"), L("Replacement", "Gantian"),
        L("Absent", "Tidak hadir"), L("Rest days", "Hari rehat"), L("Public holidays", "Cuti umum"),
        L("Late", "Lewat"), L("Early out", "Balik awal"), L("Short days", "Hari pendek"),
        L("Assigned (outside hours)", "Ditugaskan (luar waktu)"),
        L("Scheduled hours", "Jam berjadual"), L("Worked hours", "Jam bekerja"),
        L("Balances", "Seimbang"),
        L("Absent dates", "Tarikh tidak hadir"), L("Leave dates", "Tarikh cuti"),
      ],
      ...rows.map((r) => [
        r.employee_id ?? "", properName(r.name), r.email ?? "", r.position ?? "",
        r.employment_status ?? "", r.scheduled, r.worked, r.leave_total,
        r.leave_by_type.annual ?? 0, r.leave_by_type.medical ?? 0, r.leave_by_type.emergency ?? 0,
        r.leave_by_type.unpaid ?? 0, r.leave_by_type.replacement ?? 0,
        r.absent, r.rest_days, r.public_holidays,
        r.late, r.early_out, r.short_days, r.assigned_days,
        (r.scheduled_minutes / 60).toFixed(2), (r.worked_minutes / 60).toFixed(2),
        r.balances ? L("yes", "ya") : L("NO — check", "TIDAK — semak"),
        r.absent_dates.join(" "),
        r.leave_dates.map((l) => `${l.d}:${l.type}`).join(" "),
      ]),
    ]);
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{L("Attendance verification", "Pengesahan kehadiran")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("One row per person for the month. Worked + leave + absent = scheduled working days; rest days and public holidays are counted separately because nobody is absent from a day they were not due to work.",
              "Satu baris setiap orang bagi bulan itu. Bekerja + cuti + tidak hadir = hari bekerja berjadual; hari rehat dan cuti umum dikira berasingan kerana tiada sesiapa tidak hadir pada hari yang mereka tidak sepatutnya bekerja.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="month"
            className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            value={month}
            aria-label={L("Month", "Bulan")}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-50"
            disabled={rows.length === 0}
            title={L("The full report: every figure below, plus the absent and leave dates behind them", "Laporan penuh: setiap angka di bawah, campur tarikh tidak hadir dan cuti di sebaliknya")}
            onClick={exportCsv}
          >
            {L("Export CSV", "Eksport CSV")}
          </button>
        </div>
      </div>

      {/* The three figures worth seeing before any row. A month with nothing
          unbalanced and nothing absent needs no reading at all. */}
      {loaded && rows.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-medium ${unbalanced > 0 ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}
            title={L("A row that does not add up has a missing punch, a leave recorded outside its dates, or a day counted twice", "Baris yang tidak seimbang mempunyai ketukan hilang, cuti direkod di luar tarikhnya, atau hari dikira dua kali")}>
            {unbalanced === 0
              ? L("Every row balances", "Setiap baris seimbang")
              : L(`${unbalanced} row${unbalanced === 1 ? "" : "s"} do not add up`, `${unbalanced} baris tidak seimbang`)}
          </span>
          <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1">
            {L(`${totalLeave} leave day${totalLeave === 1 ? "" : "s"}`, `${totalLeave} hari cuti`)}
          </span>
          <span className={`rounded-full px-2.5 py-1 ${totalAbsent > 0 ? "bg-warning-soft text-warning font-medium" : "bg-secondary text-muted-foreground"}`}>
            {L(`${totalAbsent} absent day${totalAbsent === 1 ? "" : "s"}`, `${totalAbsent} hari tidak hadir`)}
          </span>
        </div>
      )}

      {err && <p className="text-danger mt-2 text-xs font-medium">{err}</p>}

      <div className="mt-3 max-h-[30rem] overflow-x-auto overflow-y-auto">
        <table className="tbl-sticky w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>{L("Staff", "Kakitangan")}</th>
              <th className={`${th} text-right`} title={L("Working days their own schedule gives them this month", "Hari bekerja mengikut jadual mereka sendiri bulan ini")}>{L("Days", "Hari")}</th>
              <th className={`${th} text-right`}>{L("Worked", "Bekerja")}</th>
              <th className={`${th} text-right`}>{L("Leave", "Cuti")}</th>
              <th className={`${th} text-right`}>{L("Absent", "Tidak hadir")}</th>
              <th className={th}>{L("Flags", "Penanda")}</th>
              <th className={`${th} text-right`} title={L("Hours worked against hours owed, break excluded", "Jam bekerja berbanding jam diperlukan, rehat dikecualikan")}>{L("Hours", "Jam")}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {!loaded && Array.from({ length: 6 }, (_, i) => (
              <tr key={`skel-${i}`} className="border-border border-b last:border-0" aria-hidden>
                <td className={td}><Skel className="h-4 w-36" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-6" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-6" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-6" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-6" /></td>
                <td className={td}><Skel className="h-4 w-24" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-16" /></td>
                <td className={td}><Skel className="h-6 w-14 rounded-lg" /></td>
              </tr>
            ))}
            {loaded && rows.length === 0 && !err && (
              <tr><td className={`${td} text-muted-foreground`} colSpan={8}>{L("No staff to report on for this month.", "Tiada kakitangan untuk dilaporkan bulan ini.")}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.user_id} className={`border-border border-b last:border-0 ${!r.balances ? "bg-danger-soft/30" : ""}`}>
                <td className={`${td} align-top`}>
                  <span className="block font-medium whitespace-nowrap">{properName(r.name)}</span>
                  <span className="text-muted-foreground block text-xs">{r.position ?? r.role}</span>
                </td>
                <td className={`${td} text-right align-top`}>{r.scheduled}</td>
                <td className={`${td} text-right align-top font-medium`}>{r.worked}</td>
                <td className={`${td} text-right align-top`}>
                  {r.leave_total > 0 ? (
                    <span className="text-info font-medium"
                      title={Object.entries(r.leave_by_type).map(([t, n]) => `${leaveLabel(t)}: ${n}`).join(" · ")}>
                      {r.leave_total}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={`${td} text-right align-top`}>
                  {r.absent > 0
                    ? <span className="text-danger font-semibold">{r.absent}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={`${td} align-top text-xs whitespace-nowrap`}>
                  {r.late > 0 && <span className="text-warning mr-1.5">{L(`${r.late} late`, `${r.late} lewat`)}</span>}
                  {r.short_days > 0 && <span className="text-warning mr-1.5">{L(`${r.short_days} short`, `${r.short_days} pendek`)}</span>}
                  {r.assigned_days > 0 && <span className="text-success mr-1.5">{L(`${r.assigned_days} assigned`, `${r.assigned_days} ditugaskan`)}</span>}
                  {r.late === 0 && r.short_days === 0 && r.assigned_days === 0 && <span className="text-muted-foreground">—</span>}
                </td>
                <td className={`${td} text-right align-top whitespace-nowrap`}>
                  <span className="font-medium">{hm(r.worked_minutes)}</span>
                  <span className="text-muted-foreground">{" / "}{hm(r.scheduled_minutes)}</span>
                </td>
                <td className={`${td} align-top`}>
                  {(r.absent_dates.length > 0 || r.leave_dates.length > 0) && (
                    <button type="button" className={rowBtn}
                      onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>
                      {open === r.user_id ? L("Hide", "Sembunyi") : L("Dates", "Tarikh")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* The dates behind the two figures anybody queries. On the row
                they belong to, because a detail panel somewhere else is a
                detail panel nobody connects to the number. */}
            {rows.filter((r) => open === r.user_id).map((r) => (
              <tr key={`open-${r.user_id}`} className="border-border border-b last:border-0">
                <td className={`${td} bg-secondary/40 text-xs`} colSpan={8}>
                  {r.absent_dates.length > 0 && (
                    <p>
                      <span className="text-danger font-semibold">{L("Absent", "Tidak hadir")}: </span>
                      {r.absent_dates.map((d) => dmy(d)).join(" · ")}
                    </p>
                  )}
                  {r.leave_dates.length > 0 && (
                    <p className={r.absent_dates.length > 0 ? "mt-1" : ""}>
                      <span className="text-info font-semibold">{L("Leave", "Cuti")}: </span>
                      {r.leave_dates.map((l) => `${dmy(l.d)} (${leaveLabel(l.type)})`).join(" · ")}
                    </p>
                  )}
                  {!r.balances && (
                    <p className="text-danger mt-1 font-medium">
                      {L(`This row does not add up: ${r.worked} worked + ${r.leave_total} leave + ${r.absent} absent is not ${r.scheduled} scheduled days. Usually a punch recorded on a rest day, or a leave whose dates fall outside the month.`,
                         `Baris ini tidak seimbang: ${r.worked} bekerja + ${r.leave_total} cuti + ${r.absent} tidak hadir bukan ${r.scheduled} hari berjadual. Biasanya ketukan pada hari rehat, atau cuti yang tarikhnya di luar bulan ini.`)}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
