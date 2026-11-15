"use client";

/* v1.307.0 - ATTENDANCE WORKSPACE 4.0: the words and chips every Attendance
   view uses for THE verdict (worker/src/attendance-day.ts). One vocabulary,
   so the Overview, Records and the Roster can never say different things
   about the same person and day. */

import { L } from "@/components/portal/page-shared";
import { chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";

export type DayStatus =
  | "rest_day" | "holiday" | "leave" | "present" | "late" | "on_shift" | "missing_out"
  | "pending" | "not_due" | "not_in" | "absent";

export interface LocOut { status: string; distance_m: number | null; accuracy_m: number | null }
export interface DayPunch { id: number; type: string; at: string; pending: boolean; source: "punch" | "manual" | "amended"; loc: LocOut; gps?: string | null }
export interface PersonDay {
  id: number; name: string; role: string; position: string | null; department: string | null;
  verdict: { status: DayStatus; late: boolean; lateMinutes: number; workedOffDay: boolean; start: number | null; end: number | null };
  shift_label: string | null; pattern: string | null; holiday_name: string | null; leave_type: string | null;
  first_in: string | null; last_out: string | null; worked_minutes: number; sessions: number; pending: number;
  punches?: DayPunch[];
}
export interface DayRegister { date: string; grace_minutes: number; site: { label?: string; radius_m: number } | null; staff: PersonDay[] }

const LEAVE: Record<string, [string, string]> = {
  annual: ["Annual leave", "Cuti tahunan"], medical: ["Medical leave", "Cuti sakit"], emergency: ["Emergency leave", "Cuti kecemasan"],
  unpaid: ["Unpaid leave", "Cuti tanpa gaji"], replacement: ["Replacement leave", "Cuti gantian"],
};
export const leaveWord = (t: string | null | undefined) => (t && LEAVE[t] ? L(LEAVE[t][0], LEAVE[t][1]) : L("On leave", "Bercuti"));

export const STATUS: Record<DayStatus, [string, string, string]> = {
  present: ["Present", "Hadir", chipSmSuccess],
  late: ["Late", "Lewat", chipSmWarn],
  on_shift: ["On shift", "Sedang syif", chipSmInfo],
  missing_out: ["Missing clock-out", "Tiada daftar keluar", chipSmWarn],
  pending: ["Pending approval", "Menunggu kelulusan", chipSmInfo],
  not_due: ["Not yet due", "Belum masanya", chipSmNeutral],
  not_in: ["Not clocked in", "Belum daftar masuk", chipSmDanger],
  absent: ["Absent", "Tidak hadir", chipSmDanger],
  leave: ["On leave", "Bercuti", chipSmInfo],
  rest_day: ["Rest day", "Hari rehat", chipSmNeutral],
  holiday: ["Holiday", "Cuti umum", chipSmNeutral],
};
export function StatusChip({ p }: { p: Pick<PersonDay, "verdict" | "leave_type" | "holiday_name"> }) {
  const s = p.verdict.status;
  const w = STATUS[s] ?? [s, s, chipSmNeutral];
  const label = s === "leave" ? leaveWord(p.leave_type) : L(w[0], w[1]);
  return <span className={w[2]} title={s === "holiday" && p.holiday_name ? p.holiday_name : undefined} data-status={s}>{label}{p.verdict.workedOffDay ? L(" · worked", " · bekerja") : ""}</span>;
}

/** HH:MM Malaysia time for a stored UTC stamp */
export const mytHm = (at: string | null | undefined) => (at ? new Date(Date.parse(`${at.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(11, 16) : "—");
export const hm = (min: number) => (min > 0 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "—");
export const hhmm = (min: number | null) => (min == null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

/** where a punch was made, as the server judged it - a word and a distance, never a position */
export function locText(loc: LocOut | null | undefined): { text: string; tone: "ok" | "warn" | "muted" } {
  if (!loc || loc.status === "none") return { text: "—", tone: "muted" };
  const d = loc.distance_m;
  const dist = d == null ? "" : d >= 1000 ? ` · ${(d / 1000).toFixed(1)} km` : ` · ${d} m`;
  if (loc.status === "verified") return { text: L(`Main office${dist}`, `Pejabat utama${dist}`), tone: "ok" };
  if (loc.status === "outside") return { text: L(`Outside office${dist}`, `Di luar pejabat${dist}`), tone: "warn" };
  if (loc.status === "denied" || loc.status === "unavailable") return { text: L("No location", "Tiada lokasi"), tone: "warn" };
  return { text: L(`Location recorded${dist}`, `Lokasi direkod${dist}`), tone: "muted" };
}

export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
