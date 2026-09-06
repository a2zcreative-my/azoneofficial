"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import type { ReactNode } from "react";
import { Lang, getLang } from "@/lib/i18n";

/* v1.25.1 — remembered-data keys for the Dashboard's own four requests. */
export type DashCache = {
  records: { type: string; created_at: string }[];
  ot?: { type: string; created_at: string }[];
  ot_eligible?: boolean;
};
export const DASH_ATT = "dash:attendance";
export const DASH_LEAVE = "dash:leave";
export const DASH_TASKS = "dash:tasks";
export const DASH_ANNS = "dash:announcements";
export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  photo_key?: string | null;
  requires_2fa?: boolean;
}

/* v1.26 BM sweep — display-point translation helper. The EN argument is the
   exact original string, so EN mode renders byte-identical. NEVER used on
   strings that feed logic, state keys or API payloads. */
export const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Display-only maps for API values shown raw (the value itself stays EN). */
export const LEAVE_TYPE_MS: Record<string, string> = {
  annual: "tahunan",
  medical: "sakit",
  emergency: "kecemasan",
  unpaid: "tanpa gaji",
  replacement: "gantian",
};
export const leaveTypeL = (t: string) =>
  getLang() === "ms" ? (LEAVE_TYPE_MS[t] ?? t) : t;
export const PRIORITY_MS: Record<string, string> = {
  low: "rendah",
  normal: "biasa",
  high: "tinggi",
  urgent: "segera",
};
export const priorityL = (p: string) =>
  getLang() === "ms" ? (PRIORITY_MS[p] ?? p) : p;
export const ANN_CAT_MS: Record<string, string> = {
  news: "berita",
  meeting: "mesyuarat",
  holiday: "cuti umum",
  kpi: "kpi",
  training: "latihan",
  memo: "memo",
  event: "acara",
  class: "kelas",
};
export const annCatL = (c: string) => (getLang() === "ms" ? (ANN_CAT_MS[c] ?? c) : c);
export const SESS_STATUS_MS: Record<string, string> = {
  scheduled: "dijadualkan",
  completed: "selesai",
  cancelled: "dibatalkan",
};
export const sessStatusL = (s: string) =>
  getLang() === "ms" ? (SESS_STATUS_MS[s] ?? s) : s;
export const PAY_STATUS_MS: Record<string, string> = {
  unpaid: "belum dibayar",
  paid: "dibayar",
  overdue: "tertunggak",
  pending: "menunggu",
  delivered: "dihantar",
};
export const payStatusL = (s: string) =>
  getLang() === "ms" ? (PAY_STATUS_MS[s] ?? s) : s;
/* daysAway() output is compared against "TODAY" for styling — translate a COPY at display only. */
export const daysAwayL = (s: string) =>
  s === "TODAY"
    ? L("TODAY", "HARI INI")
    : s === "Tomorrow"
      ? L("Tomorrow", "Esok")
      : getLang() === "ms"
        ? s.replace(/^in (\d+) days$/, "dalam $1 hari")
        : s;

/**
 * Attendance timestamps are stored in UTC (datetime('now') in D1) — correct
 * for storage, wrong to show raw. These format them in Malaysia time
 * (Asia/Kuala_Lumpur, UTC+8) for display and day-grouping, so a 10:00am
 * clock-in reads 10:00, not 02:00.
 */
export function mytTime(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function mytDateTime(iso: string): string {
  // DD-MM-YYYY HH:mm in Malaysia time — the one date format system-wide.
  const d = new Date(
    new Date(iso.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000
  );
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

/* v1.15.0 — the mobile Today screen's greeting line. Hand-rolled names, not
   toLocaleDateString: the ms-MY locale data varies by browser/OS and this
   line sits at the very top of every staff member's phone screen. */
export const DAY_NAMES = {
  en: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  ms: ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"],
} as const;
export const MONTH_NAMES = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  ms: [
    "Januari",
    "Februari",
    "Mac",
    "April",
    "Mei",
    "Jun",
    "Julai",
    "Ogos",
    "September",
    "Oktober",
    "November",
    "Disember",
  ],
} as const;
export function mytGreeting(lang: Lang): string {
  const h = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
  if (lang === "ms")
    return h < 12
      ? "Selamat pagi"
      : h < 19
        ? "Selamat petang"
        : "Selamat malam";
  return h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
}
export function mytTodayLine(lang: Lang): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const names = lang === "ms" ? DAY_NAMES.ms : DAY_NAMES.en;
  const months = lang === "ms" ? MONTH_NAMES.ms : MONTH_NAMES.en;
  return `${names[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

export const MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]; // v1.4.153: CEO posts news too

/* ================= Dashboard ================= */

export interface Notification {
  id: number;
  kind: string;
  message: string;
  is_read: number;
  created_at: string;
}
export interface Task {
  id: number;
  title: string;
  description?: string | null;
  priority: string;
  deadline: string | null;
  status: string;
  progress: number;
  assignee?: string;
  assigned_to?: number;
  created_by?: number | null;
  // v1.42.0 — scope tally + acknowledgement, present post-0083
  item_count?: number;
  item_done?: number;
  acknowledged?: number;
}
export interface TaskItem { // v1.42.0 — one scope deliverable
  id: number; title: string; done: number; done_at?: string | null; done_by_name?: string | null;
}
export interface Announcement {
  id: number;
  title: string;
  body: string;
  category: string;
  created_at: string;
  acked: number;
}
export interface LeaveReq {
  id: number;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  stage?: string;
  applicant_role?: string;
  user_id?: number;
  user_name?: string;
  review_comment?: string | null;
  // v1.4.134: printable Leave Application Form fields
  reason?: string | null;
  created_at?: string;
  day_seq?: number | null;
  user_full?: string | null;
  user_position?: string | null;
  user_department?: string | null;
  hr_by_name?: string | null;
  hr_at?: string | null;
  preapp_by_name?: string | null;
  preapp_by_full?: string | null;
  preapp_by_role?: string | null;
  preapp_at?: string | null;
  final_by_name?: string | null;
  final_by_full?: string | null;
  final_at?: string | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
}

/** v1.116.0 (Dashboard) / v1.117.0 (Ecommerce) - the zone captions a tab
    reads by: MY DAY, WAITING ON ME, THE COMPANY, AROUND ME on the Dashboard;
    THIS MONTH, THE WORK, THE LONGER VIEW, SETUP on Ecommerce. Text, not
    chrome: the same small-caps the KPI tiles use for their own labels, so
    every tab teaches the same reading habit. Module scope (house rule #30). */
export function ZoneLabel({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground px-1 text-[10px] font-semibold tracking-widest uppercase">{children}</p>;
}
