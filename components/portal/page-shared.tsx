"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { type ReactNode, useState } from "react";
import { card, tabPill, tabPillOn } from "@/lib/ui-styles";
import { Lang, getLang } from "@/lib/i18n";

/* v1.25.1 — remembered-data keys for the Dashboard's own four requests. */
export type DashCache = {
  records: { type: string; created_at: string }[];
  ot?: { type: string; created_at: string }[];
  ot_eligible?: boolean;
  /* v1.133.0 — every block of today's pattern, so the card can say which
     shifts to clock for. null when the schedule cannot be read. */
  today_shift?: {
    kind: string; label: string; windows: { start: string; end: string }[];
    /* v1.133.2 — the SHIFTS (blocks + roster + live board), which are
       already clocked in for, and whether a clock-in is possible right now. */
    slots?: { start: string; end: string; what: string | null; claimed: boolean }[];
    slots_label?: string; can_clock_in?: boolean; why_not?: string | null;
  } | null;
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

/** v1.121.0 - THE QUIET CARD. The CEO, 06-09-2026: "I want minimalist UI/UX
    for this Inventory tabs" - a card that is one line (its title and its one
    figure) until tapped; nothing inside changes. v1.122.0: shared with the
    ELFIA Store tab, so the same gesture means the same thing everywhere. */
export function QuietCard({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={card}>
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && <span className="text-muted-foreground mt-0.5 block truncate text-xs">{summary}</span>}
        </span>
        <span aria-hidden className={`text-muted-foreground shrink-0 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** v1.123.0 - ONE ROW OF TABS, everywhere. The CEO, 06-09-2026, naming the
    attendance card as the reference: a card that holds several things shows
    one at a time, chosen by a pill row, instead of stacking them all open.
    The bodies are HIDDEN, never unmounted - a tab that refetched and lost
    its half-typed form on every switch would be a worse card than the stack
    it replaced. Module scope (house rule #30). */
export function SectionTabs<T extends string>({ value, onChange, tabs, className = "" }: {
  value: T;
  onChange: (v: T) => void;
  tabs: readonly (readonly [T, string])[];
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex flex-wrap gap-1.5 ${className}`}>
      {tabs.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k}
          className={value === k ? tabPillOn : tabPill} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* v1.127.0 — THE STEP-UP RETRY.

   The final approval on a leave form or a claim attaches an officer's chop
   and releases time off or money, so the worker asks for a live authenticator
   code before it will sign (requireFreshTotp in worker/src/staff.ts).

   The client does not try to work out which approval is the final one. It
   sends the decision, and if the server answers 401 totp_required it asks for
   the code and sends the same decision again. The rule stays in ONE place --
   the server, which owns the approval chain -- and the portal cannot drift
   out of step with it by getting the chain arithmetic subtly wrong.

   Returns the final result. `ask` is the usePrompt() prompt from the calling
   component, so the dialog matches every other dialog in the app. */
export async function withStepUp<T>(
  send: (totp?: string) => Promise<{ ok: boolean; status: number; data: T | null }>,
  ask: (o: { title: string; label: string; placeholder?: string; required?: boolean }) => Promise<{ value: string } | null>,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const first = await send();
  if (first.ok || first.status !== 401) return first;
  const code = await ask({
    title: L("Sign this decision", "Tandatangani keputusan ini"),
    label: L("Your 6-digit authenticator code — this decision carries your signature", "Kod pengesah 6 digit anda — keputusan ini membawa tandatangan anda"),
    placeholder: "000000",
    required: true,
  });
  if (!code?.value) return first; // cancelled: the caller reports the original refusal
  return send(code.value.trim());
}
