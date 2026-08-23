"use client";

/**
 * A2Z CREATIVE MARKETING — Staff Portal v1 (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 * Modules: Dashboard, Attendance, Leave, Tasks, Announcements, Sales, Profile,
 * plus role modules (v1.4.4): HR, Inventory, Commercial, Operations, Overview.
 * Desktop-first, responsive; light/dark mode.
 */

import { api, csrfFetch } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { enablePush, disablePush, pushPermission } from "@/lib/push-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { properName, firstName } from "@/lib/names";
import { buildDocHtml, type DocFull, type DocItem } from "@/lib/doc-template";
import { buildDocPdf, sharePdfFile } from "@/lib/doc-pdf";
import { buildLeavePdf } from "@/lib/form-pdf";
/* v1.28.0 — legal document identity: a STAMPED document (leave form, invoice
   chase) renders the issuer stored on its row via resolveIssuer(issuer_code);
   a document issued fresh TODAY (the SOA) carries DOCUMENT_ISSUER. */
import { DOCUMENT_ISSUER, resolveIssuer, type Issuer } from "@/lib/issuers";
import { addEventToCalendar } from "@/lib/event-ics";
import { StatCard, MiniBar } from "@/components/ui/stat-card";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { HrAdminPanel } from "@/components/admin/hr-admin-panel";
import { DetailsToggle } from "@/components/ui/details-toggle";
import { MyPayslip, PayrollPanel } from "@/components/portal/payroll-panel";
/* v1.4.212 (approved architecture review): three NEW isolated cards. */
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { SalesByHourCard } from "@/components/portal/sales-by-hour-card";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { AssetsPanel } from "@/components/portal/assets-panel";
import { SITE_CONFIG } from "@/constants/site";
import { AppShell } from "@/components/layout/app-shell";
import { PortalSkeleton } from "@/components/portal/portal-skeleton";
import { LocationHelp } from "@/components/portal/location-help";
import {
  setCacheScope,
  clearApiCache,
  useCachedApi,
  cacheRead,
  cacheWrite,
} from "@/lib/cached-api";

/* v1.25.1 — remembered-data keys for the Dashboard's own four requests. */
type DashCache = {
  records: { type: string; created_at: string }[];
  ot?: { type: string; created_at: string }[];
  ot_eligible?: boolean;
};
const DASH_ATT = "dash:attendance";
const DASH_LEAVE = "dash:leave";
const DASH_TASKS = "dash:tasks";
const DASH_ANNS = "dash:announcements";
import { StaleHint, Skel, SkelText, SkelStat } from "@/components/ui/skeleton";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import {
  TabIcon,
  LogOut,
  Search,
  Bell,
  BellRing,
  BellOff,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Palette,
  CloseX,
  Ellipsis,
  ShieldOk,
} from "@/components/layout/nav-icons";
import { ContextPanel, RightRail } from "@/components/portal/side-columns";
import {
  TaskProgressCard,
  InventoryStatusCard,
} from "@/components/portal/company-monitor";
import {
  CashFlowPanel,
  ReconciliationPanel,
} from "@/components/portal/finance-panels";
import {
  CommissionPanel,
  AdsFundPanel,
} from "@/components/portal/commission-panels";
import {
  PurchasingPanel,
  AccountingPanel,
} from "@/components/portal/purchasing-panels";
import { NextEventCard } from "@/components/portal/next-event-card";
import { RosterBoard } from "@/components/portal/roster-board";
import {
  AttendanceDonutCard,
  TodayAssignmentsCard,
  MonthlyBarsCard,
} from "@/components/portal/dashboard-cards";
import { GeofenceCard } from "@/components/portal/geofence-card";
import { OpsMapCard } from "@/components/portal/ops-map";
import {
  getLang,
  setLang as persistLang,
  t as tr,
  type Lang,
} from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";
import { CommandPalette } from "@/components/layout/command-palette";
import { ContentPanel } from "@/components/portal/content-panel";
import { StokisPanel } from "@/components/portal/stokis-panel";
import { WebOrdersPanel } from "@/components/portal/web-orders-panel"; // v1.37.0
import { DocumentsPanel } from "@/components/portal/documents-panel";
import { TabAccessCard } from "@/components/portal/tab-access-card";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import {
  AttendanceAdminPanel,
  BirthdaysPanel,
  HrPanel,
  InventoryPanel,
  ClaimsPanel,
  ExpensesPanel,
  TikTokOrdersCard,
} from "@/components/portal/role-panels";
import { StaffDirectory } from "@/components/staff/staff-directory";
import {
  card,
  inputClass,
  btnClass,
  btnGhost,
  btnHdr,
  btnSm,
  btnSmPrimary,
  th,
  td,
  thR2,
  tdR2,
  fieldRow,
  btnHdrDesktop,
} from "@/lib/ui-styles";
import { dmy, mytToday, mytDateOf, fmtRM, ym } from "@/lib/format";

interface User {
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
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Display-only maps for API values shown raw (the value itself stays EN). */
const LEAVE_TYPE_MS: Record<string, string> = {
  annual: "tahunan",
  medical: "sakit",
  emergency: "kecemasan",
  unpaid: "tanpa gaji",
  replacement: "gantian",
};
const leaveTypeL = (t: string) =>
  getLang() === "ms" ? (LEAVE_TYPE_MS[t] ?? t) : t;
const PRIORITY_MS: Record<string, string> = {
  low: "rendah",
  normal: "biasa",
  high: "tinggi",
  urgent: "segera",
};
const priorityL = (p: string) =>
  getLang() === "ms" ? (PRIORITY_MS[p] ?? p) : p;
const ANN_CAT_MS: Record<string, string> = {
  news: "berita",
  meeting: "mesyuarat",
  holiday: "cuti umum",
  kpi: "kpi",
  training: "latihan",
  memo: "memo",
  event: "acara",
  class: "kelas",
};
const annCatL = (c: string) => (getLang() === "ms" ? (ANN_CAT_MS[c] ?? c) : c);
const SESS_STATUS_MS: Record<string, string> = {
  scheduled: "dijadualkan",
  completed: "selesai",
  cancelled: "dibatalkan",
};
const sessStatusL = (s: string) =>
  getLang() === "ms" ? (SESS_STATUS_MS[s] ?? s) : s;
const PAY_STATUS_MS: Record<string, string> = {
  unpaid: "belum dibayar",
  paid: "dibayar",
  overdue: "tertunggak",
  pending: "menunggu",
  delivered: "dihantar",
};
const payStatusL = (s: string) =>
  getLang() === "ms" ? (PAY_STATUS_MS[s] ?? s) : s;
const ENQ_STATUS_MS: Record<string, string> = {
  new: "baru",
  contacted: "dihubungi",
  qualified: "layak",
  closed: "ditutup",
};
const enqStatusL = (s: string) =>
  getLang() === "ms" ? (ENQ_STATUS_MS[s] ?? s) : s;
/* daysAway() output is compared against "TODAY" for styling — translate a COPY at display only. */
const daysAwayL = (s: string) =>
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
function mytTime(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function mytDateTime(iso: string): string {
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
const DAY_NAMES = {
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
const MONTH_NAMES = {
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
function mytGreeting(lang: Lang): string {
  const h = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
  if (lang === "ms")
    return h < 12
      ? "Selamat pagi"
      : h < 19
        ? "Selamat petang"
        : "Selamat malam";
  return h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
}
function mytTodayLine(lang: Lang): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const names = lang === "ms" ? DAY_NAMES.ms : DAY_NAMES.en;
  const months = lang === "ms" ? MONTH_NAMES.ms : MONTH_NAMES.en;
  return `${names[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

const MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]; // v1.4.153: CEO posts news too
const SALES_ROLES = [
  "super_admin",
  "admin",
  "hr_admin",
  "coo",
  "cco",
  "ceo",
  "sales_marketing",
];

/* ================= Dashboard ================= */

interface Notification {
  id: number;
  kind: string;
  message: string;
  is_read: number;
  created_at: string;
}
interface Task {
  id: number;
  title: string;
  priority: string;
  deadline: string | null;
  status: string;
  progress: number;
  assignee?: string;
}
interface Announcement {
  id: number;
  title: string;
  body: string;
  category: string;
  created_at: string;
  acked: number;
}
interface LeaveReq {
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

/**
 * Punch confirmation overlay (v1.4.29): centered card, animated ring +
 * check draw, brand navy, auto-dismisses. Pure CSS keyframes — no library.
 */

/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

function PunchToast({
  title,
  sub,
  variant = "success",
}: {
  title: string;
  sub: string;
  variant?: "success" | "notice";
}) {
  const colour = variant === "success" ? "#1a2946" : "#d97706";
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <style>{`
        @keyframes punch-pop { 0% { opacity: 0; transform: scale(.82) translateY(8px); } 60% { opacity: 1; transform: scale(1.03); } 100% { transform: scale(1); } }
        @keyframes punch-ring { from { stroke-dashoffset: 151; } to { stroke-dashoffset: 0; } }
        @keyframes punch-check { from { stroke-dashoffset: 36; } to { stroke-dashoffset: 0; } }
        @keyframes punch-fade { to { opacity: 0; } }
      `}</style>
      <div
        className="bg-card border-border rounded-2xl border px-8 py-6 text-center shadow-2xl"
        style={{
          animation:
            "punch-pop .45s cubic-bezier(.2,.9,.3,1.2) both, punch-fade .4s ease .2s forwards",
          animationDelay: "0s, 2.2s",
        }}
        role="status"
        aria-live="polite"
      >
        <svg
          viewBox="0 0 52 52"
          className="mx-auto h-14 w-14"
          aria-hidden="true"
        >
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke={colour}
            strokeWidth="2.5"
            strokeDasharray="151"
            style={{ animation: "punch-ring .6s ease-out .1s both" }}
          />
          {variant === "success" ? (
            <path
              d="M15 27l7.5 7.5L37 20"
              fill="none"
              stroke={colour}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="36"
              style={{ animation: "punch-check .35s ease-out .55s both" }}
            />
          ) : (
            <g style={{ animation: "punch-check .35s ease-out .55s both" }}>
              <path
                d="M26 14v16"
                fill="none"
                stroke={colour}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="16"
              />
              <circle cx="26" cy="37" r="2.2" fill={colour} />
            </g>
          )}
        </svg>
        <p className="mt-3 text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-sm">{sub}</p>
      </div>
    </div>
  );
}

function Dashboard({
  user,
  go,
  lang = "en",
}: {
  user: User;
  go: (t: TabName) => void;
  lang?: Lang;
}) {
  /* v1.25.1: seeded from remembered data IN THE INITIALISER — seeding only
     the "known" flag left a single frame where the answer was declared known
     while the list was still empty, which printed the false message again. */
  const [today, setToday] = useState<{ type: string; created_at: string }[]>(
    () =>
      (cacheRead<DashCache>(DASH_ATT)?.records ?? []).filter(
        (r) => mytDateOf(r.created_at) === mytToday()
      )
  );
  const [todayOt, setTodayOt] = useState<
    { type: string; created_at: string }[]
  >(() =>
    (cacheRead<DashCache>(DASH_ATT)?.ot ?? []).filter(
      (r) => mytDateOf(r.created_at) === mytToday()
    )
  );
  /* v1.15.0: the same attendance response, kept un-filtered — powers the
     personal month chart and the KPI strip without a second request. */
  const [monthRecs, setMonthRecs] = useState<
    { type: string; created_at: string }[]
  >(() => cacheRead<DashCache>(DASH_ATT)?.records ?? []);
  /* v1.15.0: the same tasks response, kept un-filtered — the mobile Today
     checklist needs completed items too for its "2 of 4 done" count. */
  const [allTasks, setAllTasks] = useState<Task[]>(
    () => cacheRead<Task[]>(DASH_TASKS) ?? []
  );
  const [otEligible, setOtEligible] = useState(
    () => cacheRead<DashCache>(DASH_ATT)?.ot_eligible === true
  );
  const [leave, setLeave] = useState<LeaveReq[]>(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) ?? []
  );
  const [tasks, setTasks] = useState<Task[]>(() =>
    (cacheRead<Task[]>(DASH_TASKS) ?? [])
      .filter((x) => x.status !== "completed")
      .slice(0, 5)
  );
  const [anns, setAnns] = useState<Announcement[]>(
    () => cacheRead<Announcement[]>(DASH_ANNS) ?? []
  );
  /* v1.25.1 (CEO's screen recording: the card showed a green "Clock in" and
     "No attendance recorded today." for half a second — while he had ALREADY
     clocked in at 09:13). Root cause: `today` starts as [], which is
     indistinguishable from "loaded, and genuinely nothing". The card then
     states a confident WRONG answer and invites a second punch.
     Fix — UNKNOWN UNTIL PROVEN EMPTY: these flags say whether the answer is
     actually known yet. Unknown → skeleton. Known + empty → the real "None"
     message. They are SEEDED from remembered data, so a repeat open is not
     skeleton-then-truth but truth immediately (own punches are personal and
     non-financial, so instant display is safe). */
  const [attKnown, setAttKnown] = useState(
    () => cacheRead<DashCache>(DASH_ATT) !== null
  );
  const [leaveKnown, setLeaveKnown] = useState(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) !== null
  );
  const [tasksKnown, setTasksKnown] = useState(
    () => cacheRead<Task[]>(DASH_TASKS) !== null
  );
  const [annsKnown, setAnnsKnown] = useState(
    () => cacheRead<Announcement[]>(DASH_ANNS) !== null
  );
  const [busy, setBusy] = useState("");
  // v1.4.155: minute tick so the OT buttons appear at 18:00 MYT without a
  // manual refresh — the card is often left open on a phone all day.
  const [nowMins, setNowMins] = useState(() => {
    const m = new Date(Date.now() + 8 * 3600 * 1000);
    return m.getUTCHours() * 60 + m.getUTCMinutes();
  });
  useEffect(() => {
    const t = window.setInterval(() => {
      const m = new Date(Date.now() + 8 * 3600 * 1000);
      setNowMins(m.getUTCHours() * 60 + m.getUTCMinutes());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  /* v1.25.1: paint remembered data first (instant + correct), then refresh.
     The four requests below used to run one after another — four round-trips
     stacked end to end on a phone; they now go together. */
  const applyAtt = useCallback((d: DashCache) => {
    setMonthRecs(d.records ?? []);
    setToday(
      (d.records ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
    );
    setTodayOt(
      (d.ot ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
    );
    setOtEligible(d.ot_eligible === true);
    setAttKnown(true);
  }, []);
  const applyTasks = useCallback((all: Task[]) => {
    setAllTasks(all);
    setTasks(all.filter((x) => x.status !== "completed").slice(0, 5));
    setTasksKnown(true);
  }, []);
  const load = useCallback(async () => {
    const month = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 7);
    const [a, l, t] = await Promise.all([
      api<DashCache>(`/staff/attendance?month=${month}`),
      api<{ leave: LeaveReq[] }>(`/staff/leave`),
      api<{ tasks: Task[] }>(`/staff/tasks`),
    ]);
    if (a.data) {
      applyAtt(a.data);
      cacheWrite(DASH_ATT, a.data);
    } else setAttKnown(true);
    const pending = (l.data?.leave ?? []).filter((x) => x.status === "pending");
    setLeave(pending);
    setLeaveKnown(true);
    if (l.data) cacheWrite(DASH_LEAVE, pending);
    applyTasks(t.data?.tasks ?? []);
    if (t.data) cacheWrite(DASH_TASKS, t.data.tasks ?? []);
    const n = await api<{ announcements: Announcement[] }>(
      `/staff/announcements`
    );
    setAnnsKnown(true);
    if (n.data?.announcements)
      cacheWrite(DASH_ANNS, n.data.announcements.slice(0, 3));
    setAnns((n.data?.announcements ?? []).slice(0, 3));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [punchToast, setPunchToast] = useState<{
    title: string;
    sub: string;
    variant?: "success" | "notice";
  } | null>(null);
  const [punchError, setPunchError] = useState("");
  /* v1.9.1 — office geofence replaces the selfie step. When a fence is set
     (management, Users tab), the punch grabs the phone's position first and
     the server refuses punches outside the radius. No fence → old behaviour. */
  const [fence, setFence] = useState<{
    configured: boolean;
    radius_m?: number;
    label?: string;
  } | null>(null);
  /* v1.17.0 — on-demand location check (CEO: "I still cant see the gps
     detection"). Runs the SAME server rule the punch enforces and mirrors
     the verdict back, without creating any record. Tap-initiated only: an
     automatic probe would fire the browser's location prompt on page open. */
  const [gpsCheck, setGpsCheck] = useState<
    | { state: "idle" | "busy" }
    | {
        state: "done";
        inside: boolean;
        distance_m: number;
        radius_m: number;
        label: string;
      }
    | { state: "error"; message: string; denied?: boolean }
  >({ state: "idle" });
  const checkLocation = async () => {
    setGpsCheck({ state: "busy" });
    const { gps, reason } = await getGpsFull();
    if (!gps) {
      /* v1.25.2: this used to say "blocked — check your browser settings" for
         EVERY failure, so staff who had already granted permission were sent
         to fix a setting that was correct. Each cause now gets its own words. */
      const msg =
        reason === "policy"
          ? lang === "ms"
            ? "Lokasi disekat oleh binaan laman web itu sendiri — bukan telefon anda. Maklumkan CEO/admin: deploy terkini perlu dijalankan (DEPLOY.bat penuh)."
            : "Location is blocked by the website build itself — NOT your phone. Tell the CEO/admin: the latest deploy needs to run (full DEPLOY.bat)."
          : reason === "denied"
            ? lang === "ms"
              ? "Lokasi disekat untuk laman ini — benarkan lokasi dalam tetapan tapak pelayar anda."
              : "Location is blocked for this site — allow it in your browser's site settings (the padlock/⋮ menu), not just in phone Settings."
            : reason === "unsupported"
              ? lang === "ms"
                ? "Pelayar ini tidak menyokong lokasi."
                : "This browser cannot provide location."
              : lang === "ms"
                ? "Tidak dapat isyarat lokasi — hidupkan Lokasi telefon, dekati tingkap dan cuba lagi."
                : "No location signal yet — switch phone Location ON, step near a window, then tap again.";
      setGpsCheck({
        state: "error",
        message: msg,
        denied: reason === "denied",
      });
      return;
    }
    const r = await api<{
      configured: boolean;
      inside?: boolean;
      distance_m?: number;
      radius_m?: number;
      label?: string;
    }>(`/staff/attendance/geofence/check`, {
      method: "POST",
      body: JSON.stringify({ gps }),
    });
    if (r.ok && r.data?.configured && typeof r.data.inside === "boolean") {
      setGpsCheck({
        state: "done",
        inside: r.data.inside,
        distance_m: r.data.distance_m ?? 0,
        radius_m: r.data.radius_m ?? 0,
        label: r.data.label ?? "the office",
      });
    } else {
      setGpsCheck({
        state: "error",
        message:
          lang === "ms"
            ? "Semakan gagal — cuba lagi."
            : "Check failed — try again.",
      });
    }
  };
  const fmtDist = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  useEffect(() => {
    void api<{ configured: boolean; radius_m?: number; label?: string }>(
      `/staff/attendance/geofence`
    ).then((r) => setFence(r.ok && r.data ? r.data : { configured: false }));
  }, []);
  /* v1.18.1: reports DENIED separately from "couldn't get a fix" — the CEO
     wants staff told when their punch was recorded without location, and
     "you blocked it" needs different words from "GPS timed out". */
  /* v1.25.2 (staff: "the location was not capture which is they already
     toggle on the location permission!" — screenshots showed Android
     permission correctly set to "Allow only while using the app" + precise
     location ON).
     THE BUG WAS OURS: a single high-accuracy request with a 10-second
     timeout. enableHighAccuracy asks the phone for a SATELLITE fix — which
     is exactly what does not work INSIDE a building, and inside the office
     is precisely where staff clock in. The request timed out, we reported
     "no location", and the person was told to check permissions they had
     already granted.
     Now it is staged: a short high-accuracy attempt (instant outdoors),
     then a fallback to NETWORK positioning (wifi/cell), which answers in
     about a second indoors and is accurate to tens of metres — far inside
     the 120 m office fence. A real denial short-circuits immediately; there
     is no point retrying a permission the person refused. */
  type GpsFail =
    "denied" | "timeout" | "unavailable" | "unsupported" | "policy";
  const getGpsFull = () =>
    new Promise<{
      gps: string | null;
      denied: boolean;
      reason: GpsFail | null;
    }>((resolve) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        resolve({ gps: null, denied: false, reason: "unsupported" });
        return;
      }
      /* v1.26.3: the v1.23.5 _headers shipped Permissions-Policy geolocation=()
       — the SITE ITSELF forbade location, and Android browsers enforce that
       as an instant "denied", which we mislabelled as the phone blocking it
       for three releases. Chromium exposes the policy — check it FIRST, so
       if a build ever forbids geolocation again it announces itself as a
       deploy problem instead of sending staff to fix innocent phones. */
      const fp = (
        document as unknown as {
          featurePolicy?: { allowsFeature?: (f: string) => boolean };
        }
      ).featurePolicy;
      if (fp?.allowsFeature && !fp.allowsFeature("geolocation")) {
        resolve({ gps: null, denied: true, reason: "policy" });
        return;
      }
      const ok = (p: GeolocationPosition) =>
        resolve({
          gps: `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)},${Math.round(p.coords.accuracy)}`,
          denied: false,
          reason: null,
        });
      const ask = (
        opts: PositionOptions,
        onFail: (e: { code: number }) => void
      ) => {
        // an insecure context throws synchronously — treat as unavailable
        try {
          navigator.geolocation.getCurrentPosition(ok, onFail, opts);
        } catch {
          onFail({ code: 2 });
        }
      };
      ask(
        { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
        (e1) => {
          if (e1.code === 1) {
            resolve({ gps: null, denied: true, reason: "denied" });
            return;
          }
          ask(
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 },
            (e2) => {
              resolve({
                gps: null,
                denied: e2.code === 1,
                reason:
                  e2.code === 1
                    ? "denied"
                    : e2.code === 3
                      ? "timeout"
                      : "unavailable",
              });
            }
          );
        }
      );
    });
  const getGps = async () => (await getGpsFull()).gps;
  /* v1.21.6 (CEO: "On mobile, I cant see the details of the task assigned…
     how to notify staff that he has a assigned schedule and roaster? The
     dashboard mobile view doesnt show any"): the bell/push notification
     already fires on assignment — what was missing is a PLACE on the phone
     where the schedule lives. This card shows the person's own upcoming
     roster/live sessions right on the Dashboard, both breakpoints. */
  type MySess = {
    id: number;
    session_date: string;
    start_time: string;
    end_time?: string | null;
    platform: string;
    client_company?: string | null;
    client_name?: string | null;
    host_user_id: number;
    status: string;
    notes?: string | null;
  };
  const [mySessions, setMySessions] = useState<MySess[]>([]);
  useEffect(() => {
    void api<{ sessions?: MySess[] }>(`/staff/live-sessions`).then((r) => {
      if (!r.ok || !r.data?.sessions) return;
      const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      setMySessions(
        r.data.sessions
          .filter(
            (s) =>
              s.host_user_id === user.id &&
              s.status === "scheduled" &&
              s.session_date >= todayIso
          )
          .slice(0, 5)
      );
    });
  }, [user.id]);

  const punch = async (type: string) => {
    // v1.4.113: flow is clock IN → clock OUT. Trying to clock out before
    // clocking in gets an instant popup (and the server refuses it too).
    if (type === "clock_out" && !today.some((r) => r.type === "clock_in")) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub: L(
          "You haven't clocked in today — clock in first, then clock out at the end of your shift.",
          "Anda belum daftar masuk hari ini — daftar masuk dahulu, kemudian daftar keluar pada hujung syif anda."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    setBusy(type);
    setPunchError("");
    /* v1.18.1 (CEO): location is captured on EVERY punch, fence or no fence —
       fence OFF means it is recorded for the register without being enforced;
       fence ON keeps the server-side refusal. The prompt only ever fires on
       the punch tap itself (user-initiated), never on page load. */
    const { gps, denied: gpsDenied, reason: gpsReason } = await getGpsFull();
    // A likely duplicate (button shows ✓) is sent WITHOUT blocking on
    // location — the server answers "already punched" before the fence check.
    const likelyDup =
      type === "clock_in"
        ? today.some((r) => r.type === "clock_in")
        : today.some((r) => r.type === "clock_out");
    /* v1.21.4 (CEO): location is required on EVERY punch — no longer only
       when the fence config is present. The server refuses without it too;
       this check just gives the person the right words before a round-trip. */
    /* v1.25.3 (CEO: "record it, flag it loudly"): a phone whose permission is
       stuck must not cost someone their attendance record. The punch goes
       through carrying the REASON; the server stores it as NO LOCATION,
       shows it in red in the register and tells HR. We still say so plainly
       here so the person knows it was not a clean punch. */
    if (!gps && !likelyDup && gpsReason) {
      const res0 = await api<{ error?: { message?: string } }>(
        `/staff/attendance`,
        {
          method: "POST",
          body: JSON.stringify({ type, no_location_reason: gpsReason }),
        }
      );
      setBusy("");
      if (res0.ok) {
        setPunchToast({
          title:
            type === "clock_in"
              ? L(
                  "Clocked in — without location",
                  "Daftar masuk — tanpa lokasi"
                )
              : L(
                  "Clocked out — without location",
                  "Daftar keluar — tanpa lokasi"
                ),
          sub: gpsDenied
            ? L(
                "Recorded and flagged for HR. Your phone is blocking location for this site — fix it with the steps on the Dashboard so tomorrow's punch is clean.",
                "Direkodkan dan ditandakan untuk HR. Telefon anda menyekat lokasi untuk laman ini — betulkan dengan langkah di Papan Pemuka supaya punch esok bersih."
              )
            : L(
                "Recorded and flagged for HR — no GPS signal here. Try near a window next time.",
                "Direkodkan dan ditandakan untuk HR — tiada isyarat GPS di sini. Cuba berdekatan tingkap lain kali."
              ),
          variant: "notice",
        });
        window.setTimeout(() => setPunchToast(null), 6000);
        void load();
        return;
      }
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: gpsDenied
          ? L(
              `Location is blocked for THIS SITE — open the padlock/⋮ menu in your browser, allow Location, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again. (Phone Settings alone is not enough.)`,
              `Lokasi disekat untuk LAMAN INI — buka menu mangga/⋮ dalam pelayar anda, benarkan Lokasi, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula. (Tetapan telefon sahaja tidak mencukupi.)`
            )
          : L(
              `No location signal yet — check phone Location is ON, step near a window, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again.`,
              `Belum ada isyarat lokasi — pastikan Lokasi telefon HIDUP, dekati tingkap, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula.`
            ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4800);
      return;
    }
    const res = await api<{ flag?: string; error?: { message?: string } }>(
      `/staff/attendance`,
      {
        method: "POST",
        body: JSON.stringify({ type, ...(gps ? { gps } : {}) }),
      }
    );
    setBusy("");
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      // Already punched today — confirm it with the recorded time rather than
      // leaving the person unsure whether the tap registered.
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Already clocked in", "Sudah daftar masuk")
            : L("Already clocked out", "Sudah daftar keluar"),
        sub:
          res.data?.error?.message?.replace(
            /^You already clocked (in|out) today at /,
            L("Recorded at ", "Direkodkan pada ")
          ) ?? L("Recorded earlier today", "Direkodkan lebih awal hari ini"),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.flag) {
      const label: Record<string, string> = {
        ok: L("On time", "Tepat masa"),
        late: L("Marked late", "Ditanda lewat"),
        half_day: L("Half day (after 12:00)", "Separuh hari (selepas 12:00)"),
        early_out: L("Early out (before 18:00)", "Keluar awal (sebelum 18:00)"),
        completed: L("Shift completed", "Syif selesai"),
      };
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const hhmm = now.toISOString().slice(11, 16);
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Clock-in recorded", "Daftar masuk direkodkan")
            : L("Clock-out recorded", "Daftar keluar direkodkan"),
        sub: `${label[res.data.flag] ?? res.data.flag} · ${hhmm} MYT${
          gps
            ? ""
            : gpsDenied
              ? L(
                  " · no location — enable location access for this site",
                  " · tiada lokasi — benarkan akses lokasi untuk laman ini"
                )
              : L(" · no location recorded", " · tiada lokasi direkodkan")
        }`,
        ...(gps ? {} : { variant: "notice" as const }),
      });
      window.setTimeout(() => setPunchToast(null), 2600);
    } else if (
      (res.data?.error as { code?: string } | undefined)?.code === "no_clock_in"
    ) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub:
          res.data?.error?.message ??
          L(
            "Clock in before clocking out.",
            "Daftar masuk sebelum daftar keluar."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else if (
      ["too_far", "location_required"].includes(
        (res.data?.error as { code?: string } | undefined)?.code ?? ""
      )
    ) {
      // v1.9.1: geofence refusals get a toast, not the red error line — being
      // outside the fence is expected behaviour, not a system fault.
      setPunchToast({
        title:
          (res.data?.error as { code?: string }).code === "too_far"
            ? L("📍 Too far from the office", "📍 Terlalu jauh dari pejabat")
            : L("📍 Location needed", "📍 Lokasi diperlukan"),
        sub:
          res.data?.error?.message ??
          L(
            "Move closer to the office and try again.",
            "Dekati pejabat dan cuba lagi."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
    } else {
      setPunchError(
        res.data?.error?.message ??
          L("Punch failed — try again.", "Punch gagal — cuba lagi.")
      );
    }
    void load();
  };

  // v1.4.155: overtime punches. OT is pre-approved by the Section HOD — these
  // buttons record the hours, they are not the approval itself, and the toast
  // reminds the staff member of that every time.
  const punchOt = async (type: string) => {
    if (!today.some((r) => r.type === "clock_in")) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub: L(
          "No clock-in recorded today — overtime can only follow a worked day.",
          "Tiada daftar masuk direkodkan hari ini — OT hanya boleh selepas hari bekerja."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    if (type === "ot_out" && !todayOt.some((r) => r.type === "ot_in")) {
      setPunchToast({
        title: L("OT in first", "OT masuk dahulu"),
        sub: L(
          "Tap OT in when overtime starts, then OT out when you finish.",
          "Tekan OT in apabila OT bermula, kemudian OT out apabila selesai."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    setBusy(type);
    setPunchError("");
    // v1.9.1: OT punches are gated by the same office fence as clock punches.
    // v1.18.1: position captured on every OT punch too (recorded even with
    // the fence off — they are the paid hours).
    const otGps = await getGps();
    // v1.21.4: OT punches carry the same location requirement as clock punches.
    if (!otGps) {
      setBusy("");
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: L(
          "OT punches need your location — allow location access and try again.",
          "Punch OT memerlukan lokasi anda — benarkan akses lokasi dan cuba lagi."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4200);
      return;
    }
    const res = await api<{ at?: string; error?: { message?: string } }>(
      `/staff/attendance/ot`,
      {
        method: "POST",
        body: JSON.stringify({ type, ...(otGps ? { gps: otGps } : {}) }),
      }
    );
    setBusy("");
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      setPunchToast({
        title:
          type === "ot_in"
            ? L("OT in already recorded", "OT masuk sudah direkodkan")
            : L("OT out already recorded", "OT keluar sudah direkodkan"),
        sub:
          res.data?.error?.message?.replace(
            /^You already recorded OT (in|out) today at /,
            L("Recorded at ", "Direkodkan pada ")
          ) ?? L("Recorded earlier today", "Direkodkan lebih awal hari ini"),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.at) {
      setPunchToast({
        title:
          type === "ot_in"
            ? L("OT in recorded", "OT masuk direkodkan")
            : L("OT out recorded", "OT keluar direkodkan"),
        sub:
          type === "ot_in"
            ? L(
                `${res.data.at} MYT — only proceed if your Section HOD approved this overtime.`,
                `${res.data.at} MYT — teruskan hanya jika HOD Seksyen anda meluluskan OT ini.`
              )
            : L(
                `${res.data.at} MYT — overtime completed. Thank you.`,
                `${res.data.at} MYT — OT selesai. Terima kasih.`
              ),
      });
      window.setTimeout(() => setPunchToast(null), 3200);
    } else if (res.data?.error?.message) {
      setPunchToast({
        title: L("Overtime", "OT"),
        sub: res.data.error.message,
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else {
      setPunchError(
        L("OT punch failed — try again.", "Punch OT gagal — cuba lagi.")
      );
    }
    void load();
  };

  const hasIn = today.some((r) => r.type === "clock_in");
  const hasOut = today.some((r) => r.type === "clock_out");
  const hasOtIn = todayOt.some((r) => r.type === "ot_in");
  const hasOtOut = todayOt.some((r) => r.type === "ot_out");
  // OT buttons: eligible staff only (not part-time live hosts), from 18:00 MYT
  // on weekdays. v1.4.179 (CEO): WEEKENDS are rest days — any work is OT, so
  // the buttons show ALL DAY on Sat/Sun (executives stay excluded via
  // ot_eligible). Also kept visible after a punch exists so a recorded OT day
  // never "loses" its buttons to a clock edge case.
  const isWeekendMYT = [0, 6].includes(
    new Date(Date.now() + 8 * 3600 * 1000).getUTCDay()
  );
  const showOt =
    otEligible && (isWeekendMYT || nowMins >= 18 * 60 || todayOt.length > 0);

  /* v1.15.0 — personal month stats from the punches already fetched.
     Hours pair the FIRST clock-in with the LAST clock-out per MYT day, so a
     duplicate punch can't double-count; a day still in progress contributes
     presence but no hours (honest: we don't know the total yet). */
  const dayPairs = (() => {
    const m = new Map<string, { in?: number; out?: number }>();
    for (const r of monthRecs) {
      const d = mytDateOf(r.created_at);
      const t = new Date(r.created_at.replace(" ", "T") + "Z").getTime();
      const e = m.get(d) ?? {};
      if (r.type === "clock_in")
        e.in = e.in === undefined ? t : Math.min(e.in, t);
      if (r.type === "clock_out")
        e.out = e.out === undefined ? t : Math.max(e.out, t);
      m.set(d, e);
    }
    return m;
  })();
  const daysPresent = dayPairs.size;
  const monthHours = Array.from(dayPairs.values()).reduce(
    (a, e) =>
      a +
      (e.in !== undefined && e.out !== undefined && e.out > e.in
        ? Math.min((e.out - e.in) / 3_600_000, 16)
        : 0),
    0
  );
  const doneTasks = allTasks.filter((t) => t.status === "completed").length;

  /* v1.10.0 (reference design): the mockup's punchy action buttons — taller
     and rounder on phones, pixel-identical to btnClass/btnGhost from `sm` up.
     Self-contained strings (NOT btnClass + overrides): two conflicting
     unprefixed utilities like h-9 + h-12 resolve by stylesheet order, not
     class order — a silent trap. Class changes ONLY; every handler, guard
     and geofence path is untouched. */
  const qaPrimary =
    "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex items-center px-4 transition-colors disabled:opacity-50 h-12 justify-center rounded-xl text-[15px] font-semibold md:h-9 md:justify-start md:rounded-lg md:text-sm md:font-medium";
  const qaGhost =
    "border-border inline-flex items-center border px-4 transition-colors hover:bg-secondary max-md:disabled:opacity-50 h-12 justify-center rounded-xl text-[15px] font-semibold md:h-9 md:justify-start md:rounded-lg md:text-sm md:font-medium";

  return (
    <div className="space-y-3 md:space-y-6">
      {/* v1.15.0 — mobile Today greeting: date line + time-of-day hello, the
          top of the reference's phone screen. Phones only; the desktop header
          already greets. */}
      <div className="md:hidden">
        <p className="text-muted-foreground text-[12px]">
          {mytTodayLine(lang)}
        </p>
        <h2 className="mt-0.5 text-[23px] font-semibold tracking-tight">
          {mytGreeting(lang)}, {user.name.split(" ")[0]}
        </h2>
      </div>

      {/* v1.15.0 — personal KPI strip (desktop): my day and my month at a
          glance, from data this component already fetched. Company-wide
          numbers stay in the Sales Floor band below, role-gated as before. */}
      {/* v1.25.1: the KPI tiles derive from the SAME punches — while those are
          unknown they would read "—", "Not clocked in yet" and 0 days, which
          is the same false answer as the button bug. Skeletons until known. */}
      {!attKnown ? (
        <div className="hidden gap-3 md:grid md:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <SkelStat key={i} />
          ))}
        </div>
      ) : (
        <div className="hidden gap-3 md:grid md:grid-cols-4">
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {tr("Today", lang)}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {hasIn
                ? mytTime(
                    today.filter((r) => r.type === "clock_in").slice(-1)[0]
                      ?.created_at ?? ""
                  )
                : "—"}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {hasOut
                ? L("Shift completed", "Syif selesai")
                : hasIn
                  ? L("On shift", "Sedang bertugas")
                  : L("Not clocked in yet", "Belum daftar masuk")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className={`block h-full rounded-full ${hasOut ? "bg-ring-ontime w-full" : hasIn ? "bg-gold-solid w-1/2" : "w-0"}`}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Days present · month", "Hari hadir · bulan")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {daysPresent}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {L("attendance recorded", "kehadiran direkodkan")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className="bg-bar-high block h-full rounded-full"
                style={{ width: `${Math.min(100, (daysPresent / 22) * 100)}%` }}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Hours · month", "Jam · bulan")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {monthHours.toFixed(1)}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {L(
                "first in → last out, per day",
                "masuk pertama → keluar terakhir, setiap hari"
              )}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className="bg-gold-solid block h-full rounded-full"
                style={{ width: `${Math.min(100, (monthHours / 176) * 100)}%` }}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Open tasks", "Tugasan terbuka")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {tasks.length}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {leave.length > 0
                ? L(
                    `+ ${leave.length} leave pending`,
                    `+ ${leave.length} cuti menunggu`
                  )
                : L("no leave pending", "tiada cuti menunggu")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className={`block h-full rounded-full ${tasks.length > 0 ? "bg-bar-mid w-2/3" : "bg-ring-ontime w-full"}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* v1.10.0: the hero card — phones only, the desktop keeps its layout */}
      <NextEventCard lang={lang} />
      <div className={card}>
        {/* "On shift" once clocked in (the reference design's heading),
            "Quick actions" before that. */}
        <p className="text-[15px] font-semibold md:text-sm">
          {hasIn && !hasOut ? tr("On shift", lang) : tr("Quick actions", lang)}
        </p>
        {/* v1.4.146: 2-up grid on phones — equal-width, thumb-friendly, no
            ragged wrapping; the desktop keeps its inline row. v1.10.0: the
            flip moved sm→md so the whole mobile shell (nav, hero, cards,
            buttons) switches at ONE breakpoint. */}
        {/* v1.25.1: until the punches are KNOWN, show skeleton buttons — never
            a green "Clock in" for someone who already clocked in. */}
        {!attKnown ? (
          <div
            className="mt-2.5 grid grid-cols-2 gap-2 md:flex md:flex-wrap"
            aria-busy="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} className="h-10 rounded-lg md:w-36" />
            ))}
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-2 md:flex md:flex-wrap">
            <button
              type="button"
              /* v1.15.0: phones get the reference's green Clock in. tile tokens,
               not --success — that one flips to a light text-green in dark
               mode and white text on it would fail contrast. Desktop (md:)
               keeps qaPrimary's navy exactly. */
              className={`${qaPrimary} ${!hasIn ? "max-md:bg-tile-success max-md:text-tile-success-fg max-md:hover:bg-tile-success/90" : ""}`}
              disabled={!!busy}
              onClick={() => void punch("clock_in")}
            >
              {hasIn ? tr("Clocked in ✓", lang) : `📍 ${tr("Clock in", lang)}`}
            </button>
            <button
              type="button"
              className={qaGhost}
              disabled={!!busy}
              onClick={() => void punch("clock_out")}
            >
              {hasOut ? tr("Clocked out ✓", lang) : tr("Clock out", lang)}
            </button>
            <button
              type="button"
              className={qaGhost}
              onClick={() => go("Leave")}
            >
              {tr("Apply leave", lang)}
            </button>
            {SALES_ROLES.includes(user.role) && (
              <button
                type="button"
                className={qaGhost}
                onClick={() => go("Sales")}
              >
                {tr("Create quotation", lang)}
              </button>
            )}
            {showOt && (
              <>
                <button
                  type="button"
                  className={hasOtIn ? qaGhost : qaPrimary}
                  disabled={!!busy}
                  onClick={() => void punchOt("ot_in")}
                >
                  {hasOtIn ? "OT in ✓" : "OT in"}
                </button>
                <button
                  type="button"
                  className={qaGhost}
                  disabled={!!busy}
                  onClick={() => void punchOt("ot_out")}
                >
                  {hasOtOut ? "OT out ✓" : "OT out"}
                </button>
              </>
            )}
          </div>
        )}
        {showOt && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {L(
              "Working overtime today? OT in / OT out only with your Section HOD's approval — tap OT in when it starts and OT out when you finish.",
              "Bekerja OT hari ini? OT in / OT out hanya dengan kelulusan HOD Seksyen anda — tekan OT in apabila bermula dan OT out apabila selesai."
            )}
            {isWeekendMYT
              ? L(
                  " Weekend: the whole day counts as overtime — no normal clock-in needed.",
                  " Hujung minggu: sepanjang hari dikira OT — tiada daftar masuk biasa diperlukan."
                )
              : ""}
          </p>
        )}
        {punchError && (
          <p className="text-destructive mt-2 text-xs font-medium">
            {punchError}
          </p>
        )}
        {punchToast && (
          <PunchToast
            title={punchToast.title}
            sub={punchToast.sub}
            variant={punchToast.variant}
          />
        )}
        {/* v1.9.1: clock-out reminder — mirrors the 18:30/22:00 bell + push
            from the cron, for the person who has the tab open right now. */}
        {hasIn && !hasOut && nowMins >= 18 * 60 + 30 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            ⏰ {tr("Don't forget to clock out", lang)}
            {hasOtIn && !hasOtOut
              ? L(
                  " (and OT out when overtime ends)",
                  " (dan OT out apabila OT tamat)"
                )
              : ""}{" "}
            — {tr("tap Clock out before you leave.", lang)}
          </p>
        )}
        {fence?.configured && (
          <>
            {/* v1.15.0 — phone: the reference's readiness strip. Config only,
                deliberately NOT a live GPS probe: reading the position here
                would fire the browser's location prompt on every Dashboard
                open, before the person asked to punch. The real check stays
                where it belongs — server-side, at the punch. */}
            <div className="bg-secondary mt-2.5 rounded-xl px-3 py-2.5 md:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <ShieldOk
                    aria-hidden
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                  {lang === "ms"
                    ? "Semakan lokasi pejabat aktif"
                    : "Office location check is on"}
                </span>
                <button
                  type="button"
                  onClick={() => void checkLocation()}
                  disabled={gpsCheck.state === "busy"}
                  className="text-gold-deep rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap disabled:opacity-50"
                >
                  {gpsCheck.state === "busy"
                    ? lang === "ms"
                      ? "Menyemak…"
                      : "Checking…"
                    : lang === "ms"
                      ? "Semak lokasi saya"
                      : "Check my location"}
                </button>
              </div>
              {gpsCheck.state === "done" && (
                <p
                  className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold ${gpsCheck.inside ? "text-success" : "text-warning"}`}
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${gpsCheck.inside ? "bg-success" : "bg-warning"}`}
                  />
                  {gpsCheck.inside
                    ? lang === "ms"
                      ? `Dalam kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}`
                      : `Inside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}`
                    : GEOFENCE_EXEMPT_ROLES.includes(user.role)
                      ? lang === "ms"
                        ? `${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label} — lokasi anda direkodkan`
                        : `${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label} — your location is recorded`
                      : lang === "ms"
                        ? `Luar kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}. Daftar masuk direkodkan & DITANDAKAN untuk HR.`
                        : `Outside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}. Your punch is recorded and FLAGGED for HR.`}
                </p>
              )}
              {gpsCheck.state === "error" && (
                <p className="text-warning mt-1.5 text-[12px] font-medium">
                  {gpsCheck.message}
                </p>
              )}
            </div>
            <p className="text-muted-foreground mt-2 hidden text-[11px] md:block">
              {tr("Office check-in is on", lang)} —{" "}
              {GEOFENCE_EXEMPT_ROLES.includes(user.role)
                ? lang === "ms"
                  ? "lokasi anda direkodkan pada setiap daftar masuk/keluar."
                  : "your location is recorded with every punch."
                : lang === "ms"
                  ? `punch memerlukan lokasi; di luar ${fence.radius_m ?? 120} m dari ${fence.label ?? "pejabat"} ia direkodkan dan ditandakan untuk HR.`
                  : `punches require your location; outside ${fence.radius_m ?? 120} m of ${fence.label ?? "the office"} they are recorded and flagged for HR.`}{" "}
              <button
                type="button"
                className="text-gold-deep font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => void checkLocation()}
                disabled={gpsCheck.state === "busy"}
              >
                {gpsCheck.state === "busy"
                  ? lang === "ms"
                    ? "Menyemak…"
                    : "Checking…"
                  : lang === "ms"
                    ? "Semak lokasi saya"
                    : "Check my location"}
              </button>
              {gpsCheck.state === "done" && (
                <span
                  className={`ml-1.5 font-semibold ${gpsCheck.inside ? "text-success" : "text-warning"}`}
                >
                  {gpsCheck.inside
                    ? L(
                        `✓ ${fmtDist(gpsCheck.distance_m)} — inside`,
                        `✓ ${fmtDist(gpsCheck.distance_m)} — dalam kawasan`
                      )
                    : L(
                        `${fmtDist(gpsCheck.distance_m)} — outside${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch will be flagged)"}`,
                        `${fmtDist(gpsCheck.distance_m)} — luar kawasan${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch akan ditandakan)"}`
                      )}
                </span>
              )}
              {gpsCheck.state === "error" && (
                <>
                  <span className="text-warning ml-1.5">
                    {gpsCheck.message}
                  </span>
                  {/* v1.25.3: "tap the padlock" is impossible when the portal
                      was opened from a home-screen icon — the steps below are
                      chosen from what this phone actually is. */}
                  {gpsCheck.denied && <LocationHelp lang={lang} />}
                </>
              )}
            </p>
          </>
        )}
        {!attKnown ? (
          <Skel className="mt-3 h-3 w-48" />
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">
            {today.length === 0 && todayOt.length === 0
              ? L(
                  "No attendance recorded today.",
                  "Tiada kehadiran direkodkan hari ini."
                )
              : `${L("Today", "Hari ini")}: ${[
                  ...today.slice().reverse(),
                  ...todayOt.slice().reverse(),
                ]
                  .map(
                    (r) =>
                      `${
                        getLang() === "ms"
                          ? ((
                              {
                                clock_in: "masuk",
                                clock_out: "keluar",
                                ot_in: "OT masuk",
                                ot_out: "OT keluar",
                              } as Record<string, string>
                            )[r.type] ?? r.type)
                          : r.type.startsWith("ot_")
                            ? r.type.replace("ot_", "OT ")
                            : r.type.replace("_", " ")
                      } ${mytTime(r.created_at)}`
                  )
                  .join(" · ")}`}
          </p>
        )}
      </div>

      {/* v1.21.6 — My schedule: the person's own upcoming roster/live
          sessions, on the Dashboard where the phone actually opens. */}
      {mySessions.length > 0 && (
        <div className={card}>
          <p className="text-[15px] font-semibold md:text-sm">
            {lang === "ms" ? "Jadual saya" : "My schedule"}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {lang === "ms"
              ? "Sesi roster yang ditetapkan kepada anda — anda dimaklumkan setiap kali satu ditambah atau dipindah."
              : "Roster sessions assigned to you — you are notified whenever one is added or moved."}
          </p>
          <div className="mt-1.5">
            {mySessions.map((s) => {
              const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
                .toISOString()
                .slice(0, 10);
              const isToday = s.session_date === todayIso;
              return (
                <div
                  key={s.id}
                  className="border-border border-b py-2 text-sm last:border-0 last:pb-0"
                >
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <span
                      className={`font-semibold tabular-nums ${isToday ? "text-gold-deep" : ""}`}
                    >
                      {isToday
                        ? lang === "ms"
                          ? "HARI INI"
                          : "TODAY"
                        : dmy(s.session_date)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {s.start_time}
                      {s.end_time ? `–${s.end_time}` : ""}
                    </span>
                    <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                      {s.platform}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[13px] font-medium">
                    {s.client_company ??
                      s.client_name ??
                      L("Live session", "Sesi LIVE")}
                    {s.notes ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        — {s.notes}
                      </span>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* v1.15.0 — mobile Today checklist: the reference's two-column card
          grid with a progress count. Same tasks the desktop list shows; the
          full response (incl. completed) so "2 of 4 done" is countable.
          Tapping any card opens the Tasks tab — editing stays there. */}
      {allTasks.length > 0 && (
        <div className="md:hidden">
          <div className="mb-2 flex items-baseline justify-between px-0.5">
            <p className="text-[15px] font-semibold">
              {lang === "ms" ? "Senarai semak hari ini" : "Today's checklist"}
            </p>
            <p className="text-muted-foreground text-[11.5px]">
              {doneTasks} {lang === "ms" ? "daripada" : "of"} {allTasks.length}{" "}
              {lang === "ms" ? "selesai" : "done"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {allTasks.slice(0, 6).map((t) => {
              const done = t.status === "completed";
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go("Tasks")}
                  className={`border-border bg-card flex min-h-[64px] flex-col gap-1.5 rounded-2xl border p-3 text-left ${done ? "opacity-70" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`grid h-5 w-5 place-items-center rounded-md text-[11px] ${
                      done
                        ? "bg-success-soft text-success"
                        : "bg-tint-gold text-gold-deep"
                    }`}
                  >
                    {done ? "✓" : "◷"}
                  </span>
                  <span
                    className={`text-[12px] leading-snug font-medium ${done ? "line-through" : ""}`}
                  >
                    {t.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* v1.15.0 — phone month summary: the reference's compact stats card. */}
      <div className={`${card} md:hidden`}>
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">
            {lang === "ms" ? "Bulan ini" : "This month"}
          </p>
          <span className="text-muted-foreground text-[11.5px] tabular-nums">
            {mytToday().slice(0, 7)}
          </span>
        </div>
        <div className="mt-2.5 flex gap-6">
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {lang === "ms" ? "Hari" : "Days"}
            </p>
            {/* v1.25.1: zeros are a claim too — skeleton until the punches
                are actually known, same rule as the buttons above. */}
            {!attKnown ? (
              <Skel className="mt-1 h-5 w-10" />
            ) : (
              <p className="text-[19px] font-semibold tabular-nums">
                {daysPresent}
              </p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {lang === "ms" ? "Jam" : "Hours"}
            </p>
            {!attKnown ? (
              <Skel className="mt-1 h-5 w-12" />
            ) : (
              <p className="text-[19px] font-semibold tabular-nums">
                {monthHours.toFixed(1)}
              </p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {lang === "ms" ? "Tugasan" : "Tasks"}
            </p>
            {!tasksKnown ? (
              <Skel className="mt-1 h-5 w-12" />
            ) : (
              <p className="text-[19px] font-semibold tabular-nums">
                {doneTasks}/{allTasks.length}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* v1.15.0 — desktop: my attendance, day by day. First-in → last-out
          hours; today in navy; a gold half-bar marks a day still in progress
          (in, no out yet) rather than pretending the hours are known. */}
      {monthRecs.length > 0 && (
        <div className={`${card} hidden md:block`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">
              {lang === "ms" ? "Kehadiran saya" : "My attendance"} —{" "}
              {MONTH_NAMES[lang][Number(mytToday().slice(5, 7)) - 1]}
            </p>
            <p className="text-muted-foreground text-[11.5px]">
              {daysPresent} {lang === "ms" ? "hari" : "days"} ·{" "}
              {monthHours.toFixed(1)} h
            </p>
          </div>
          <div className="flex h-28 items-end gap-[3px]">
            {(() => {
              const todayS = mytToday();
              const [yy, mm] = [
                Number(todayS.slice(0, 4)),
                Number(todayS.slice(5, 7)),
              ];
              const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
              return Array.from({ length: daysIn }, (_, i) => {
                const d = `${todayS.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
                const e = dayPairs.get(d);
                const hrs =
                  e && e.in !== undefined && e.out !== undefined && e.out > e.in
                    ? Math.min((e.out - e.in) / 3_600_000, 16)
                    : 0;
                const open =
                  !!e &&
                  e.in !== undefined &&
                  (e.out === undefined || e.out <= (e.in ?? 0));
                const pct = Math.max(
                  hrs > 0 ? 8 : 0,
                  Math.round((hrs / 12) * 100)
                );
                return (
                  <div
                    key={d}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1"
                    role="img"
                    aria-label={`${d}: ${open ? L("on shift, in progress", "sedang bertugas") : `${hrs.toFixed(1)} ${L("hours", "jam")}`}`}
                  >
                    <div
                      className={`w-full rounded-t-[3px] ${d === todayS ? "bg-bar-high" : open ? "bg-gold-solid" : hrs > 0 ? "bg-bar-low group-hover:bg-bar-mid" : "bg-tint-navy"}`}
                      style={{
                        height: open && hrs === 0 ? "40%" : `${pct}%`,
                        minHeight: "2px",
                      }}
                    />
                    <span
                      className={`text-[9px] tabular-nums ${d === todayS ? "text-foreground font-semibold" : "text-muted-foreground"} ${(i + 1) % 5 === 0 || i === 0 || d === todayS ? "" : "invisible"}`}
                    >
                      {i + 1}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
          <div className="text-muted-foreground mt-2 flex gap-4 text-[11px]">
            <span>
              <i className="bg-bar-low mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("Worked", "Bekerja")}
            </span>
            <span>
              <i className="bg-gold-solid mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("In progress", "Sedang berlangsung")}
            </span>
            <span>
              <i className="bg-bar-high mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("Today", "Hari ini")}
            </span>
          </div>
        </div>
      )}

      {/* v1.4.214 (CEO reorg): LiveGmvCard + ConnectionStatusCard moved to
          the new Ecommerce tab — the Dashboard is Quick actions → the
          three-column day view → Upcoming events. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Leave")}
            onKeyDown={(e) => e.key === "Enter" && go("Leave")}
          >
            {tr("Pending leave", lang)}
            {leave.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {leave.length}
              </span>
            )}
          </p>
          {!leaveKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : leave.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("None pending.", lang)}
            </p>
          ) : (
            leave.map((l) => (
              <p key={l.id} className="mt-2 text-sm">
                {leaveTypeL(l.type)} · {dmy(l.start_date)} → {dmy(l.end_date)} (
                {l.days}d)
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Tasks")}
            onKeyDown={(e) => e.key === "Enter" && go("Tasks")}
          >
            {tr("My open tasks", lang)}
            {tasks.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {tasks.length}
              </span>
            )}
          </p>
          {!tasksKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : tasks.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("Nothing assigned.", lang)}
            </p>
          ) : (
            tasks.map((t) => (
              <p key={t.id} className="mt-2 text-sm">
                {t.title}{" "}
                <span className="text-muted-foreground">
                  · {priorityL(t.priority)}
                  {t.deadline
                    ? L(` · due ${t.deadline}`, ` · sebelum ${t.deadline}`)
                    : ""}
                </span>
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Announcements")}
            onKeyDown={(e) => e.key === "Enter" && go("Announcements")}
          >
            {tr("News", lang)}
            {anns.length > 0 && (
              <span
                className="ml-2 inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500"
                aria-hidden="true"
              ></span>
            )}
          </p>
          {!annsKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : anns.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("No announcements.", lang)}
            </p>
          ) : (
            anns.map((a) => (
              <p key={a.id} className="mt-2 text-sm">
                <span className="font-medium">{a.title}</span>{" "}
                <span className="text-muted-foreground">
                  · {annCatL(a.category)}
                </span>
              </p>
            ))
          )}
        </div>
      </div>
      {/* v1.5.0: the hero band became the Sales Floor — a trading-desk view
          of today, the KPI target (auto-computed from history), product vs
          service market targets, motivation and boost suggestions. */}
      <TradingDesk user={user} go={go} lang={lang} />

      {/* v1.4.277 (CEO): Sales revenue MOVED to the Ecommerce tab — the
          hero band already carries today + month + overall up top, so the
          detailed month card was the Dashboard's third telling of the same
          story. Ecommerce is where the channel detail lives. */}
      {/* v1.10.0: id anchor — the mobile hero card scrolls here on tap */}
      <div id="upcoming-events" className="scroll-mt-16">
        <UpcomingEventsCard role={user.role} />
      </div>
    </div>
  );
}

/* ================= Sales revenue (v1.4.75) ================= */

const REVENUE_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "cco",
  "sales_marketing",
  "marketing",
  "hr_admin",
];

interface RevenueData {
  month: string;
  last_month: string;
  today?: {
    date: string;
    tiktok_cents: number;
    tiktok_orders: number;
    invoiced_cents: number;
    invoiced_docs: number;
    other_cents?: number;
    manual_cents?: number;
  };
  yesterday?: { date: string; total_cents: number }; // v1.4.206 trend arrow
  other?: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  }; // v1.4.169 non-TikTok shipments
  manual?: {
    this_cents: number;
    this_units: number;
    last_cents: number;
    last_units: number;
  }; // v1.4.169 manual sales
  tiktok: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  };
  invoiced: {
    this_cents: number;
    this_docs: number;
    last_cents: number;
    last_docs: number;
  };
  outstanding?: { cents: number; docs: number };
  overall?: {
    total_cents: number;
    months: { month: string; cents: number }[];
    best?: { month: string; cents: number };
  }; // v1.4.276 all-time, all channels
  target_cents?: number | null;
  next_month?: string;
  last_target_cents?: number | null;
  next_target_cents?: number | null;
}

/** Sales revenue at a glance — TikTok order amounts (captured by the sync)
    plus invoices issued, this month vs last. */
/* v1.4.270 — the brand-toned hero band (CEO approved: "firmly brand-toned,
   and hero band + row bars"). Structure from his reference screenshot,
   palette from the brand: ONE navy solid card for the single most important
   number, white + gold for the rest — the v1.4.253 one-fill rule applied to
   cards. Renders progressively: each card appears when its data arrives, and
   a role that can't see revenue simply gets the cards it can see. */
interface DashSummary {
  today: string;
  pending_leave: number | null;
  pending_claims: number | null;
  pending_ot: number | null;
  low_stock: number | null;
  open_quotations: number | null;
  // v1.7.0 company pulse
  clients?: number | null;
  active_stokis?: number | null;
  lives_today?: number | null;
  attendance_today?: number | null;
  outstanding_invoices?: number | null;
  cash_in_cents?: number | null;
  cash_out_cents?: number | null;
  // v1.8.0 attendance donut
  attendance_on_time?: number | null;
  attendance_late?: number | null;
  staff_total?: number | null;
}

/* ================= v1.5.0 — the Sales Floor (trading-desk dashboard) =======
   CEO brief: "my dashboard nice like a trading sales view — Today sales,
   market target for my product and service, KPI target and motivation for
   them to hit the requirement and suggestion to boost the sales."

   One live view, four zones:
   1. TICKER   — today's number in market green/red vs yesterday, month,
                 all-time, unpaid (collections are revenue already earned).
   2. KPI      — the month target with a pace marker. The target is AUTO-
                 COMPUTED from history (beat last month by 10%, rounded up to
                 the next RM500); a manually set target always wins.
   3. MARKETS  — product vs service, each line measured against its own
                 auto-target (its last month + 10%).
   4. DESK NOTES — motivation tied to the actual pace, plus concrete,
                 data-driven suggestions to boost sales (best live hour,
                 unpaid invoices, open quotations, restocks).
   Calendar and quick actions are untouched — this replaces only the band. */

interface RevLineLite {
  key: string;
  label: string;
  total_cents: number;
  months: { month: string; cents: number }[];
}
interface HourBucket {
  hour: number;
  cents: number;
  orders: number;
}

/** Auto-target: beat last month by 10%, rounded UP to the next RM500.
    No history yet → no target (never invent a number). */
function autoTargetCents(lastCents: number): number | null {
  if (lastCents <= 0) return null;
  const raised = lastCents * 1.1;
  return Math.ceil(raised / 50_000) * 50_000;
}

function ActiveStokisSummary({ inModal }: { inModal?: boolean } = {}) {
  const [data, setData] = useState<
    { id: number; name: string; status: string; month_cents: number }[]
  >([]);
  useEffect(() => {
    void api<{
      stokis: {
        id: number;
        name: string;
        status: string;
        month_cents: number;
      }[];
    }>("/staff/stokis").then(
      (r) =>
        r.ok &&
        r.data &&
        setData(r.data.stokis.filter((s) => s.status === "active"))
    );
  }, []);
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : (
      <div className={card}>
        <p className="mb-3 text-sm font-semibold">
          ⭐ {L("Active Stokis", "Stokis aktif")}
        </p>
        {node}
      </div>
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No active stokis.", "Tiada stokis aktif.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? "overflow-y-auto" : "max-h-80 space-y-3 overflow-y-auto pr-1"
      }
    >
      {data.map((s) => (
        <div
          key={s.id}
          className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "pb-2"}`}
        >
          <p className="font-bold">{s.name}</p>
          <p className="text-muted-foreground text-xs">
            {fmtRM(s.month_cents)} {L("this month", "bulan ini")}
          </p>
        </div>
      ))}
    </div>
  );
}

/* v1.21.0 (CEO chose "allow but flag") — punches outside the office are
   RECORDED and management views mark them red; the C-suite is exempt from
   the flag but their location still shows. Display only: the location
   requirement is enforced server-side at the punch. */
const GEOFENCE_EXEMPT_ROLES = ["ceo", "coo", "cco"];

/* v1.18.1 — where a punch happened, as a human phrase. The stored gps is
   "lat,lng[,acc]"; distance is measured against the CONFIGURED fence when
   the caller has one (monitor ships it), falling back to SITE_CONFIG.
   Accuracy grace mirrors the server: radius + min(acc, 150). */
function gpsLabel(
  gps?: string | null,
  fence?: { lat: number; lng: number; radius_m: number; label?: string } | null
): { text: string; ok: boolean | null; dist: number | null } {
  if (!gps)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  // v1.25.3: deliberately-unlocated punch — surface it as a failure, not a blank.
  if (gps.startsWith("no_location:")) {
    const why = gps.slice("no_location:".length);
    return {
      text:
        why === "denied"
          ? L("NO LOCATION (blocked)", "TIADA LOKASI (disekat)")
          : why === "policy"
            ? L(
                "NO LOCATION (site build blocked it — redeploy)",
                "TIADA LOKASI (disekat oleh binaan laman — deploy semula)"
              )
            : L(`NO LOCATION (${why})`, `TIADA LOKASI (${why})`),
      ok: false,
      dist: null,
    };
  }
  const m =
    /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?/.exec(
      gps
    );
  if (!m)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  const office = fence ?? {
    lat: SITE_CONFIG.office.lat,
    lng: SITE_CONFIG.office.lng,
    radius_m: SITE_CONFIG.office.radiusM,
  };
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  const acc = m[3] ? Math.min(Number(m[3]), 150) : 0;
  const rad = Math.PI / 180;
  const dLat = (office.lat - lat) * rad;
  const dLng = (office.lng - lng) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(office.lat * rad) * Math.sin(dLng / 2) ** 2;
  const dist = Math.round(
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
  const near = dist <= office.radius_m + acc; // same rule as the server gate
  return {
    text:
      dist >= 1000
        ? L(
            `${(dist / 1000).toFixed(1)} km from HQ`,
            `${(dist / 1000).toFixed(1)} km dari HQ`
          )
        : L(`${dist} m from HQ`, `${dist} m dari HQ`),
    ok: near,
    dist,
  };
}

function InTodaySummary({ inModal }: { inModal?: boolean } = {}) {
  type MonRow = {
    id: number;
    name: string;
    role?: string;
    in_at?: string | null;
    in_gps?: string | null;
  };
  const [data, setData] = useState<MonRow[]>([]);
  const [fence, setFence] = useState<{
    lat: number;
    lng: number;
    radius_m: number;
    label?: string;
  } | null>(null);
  /* v1.21.4: distinguish "worker says fence is NOT configured" (explicit
     null → show the red deployment warning) from "old worker, field absent"
     (undefined → say nothing rather than guess). */
  const [fenceMissing, setFenceMissing] = useState(false);
  useEffect(() => {
    void api<{
      staff: MonRow[];
      geofence?: {
        lat: number;
        lng: number;
        radius_m: number;
        label?: string;
      } | null;
    }>("/staff/attendance/monitor").then((r) => {
      if (r.ok && r.data) {
        setData(r.data.staff.filter((s) => !!s.in_at));
        setFence(r.data.geofence ?? null);
        setFenceMissing("geofence" in r.data && r.data.geofence === null);
      }
    });
  }, []);
  /* v1.21.4: when the deployed worker explicitly reports NO fence, tell the
     manager plainly — this is the silent state behind "no location" punches
     being accepted before, and the fix is one full DEPLOY.bat run. */
  const fenceWarning = fenceMissing ? (
    <p
      className={`bg-danger-soft text-danger rounded-lg px-3 py-2 text-xs font-medium ${inModal ? "mx-4 mt-3 sm:mx-5" : "mb-2"}`}
    >
      Office geofence is NOT active on this deployment — run DEPLOY.bat in full
      (step 2 seeds it via migration 0072), then punches require location and
      outside-office flags turn on.
    </p>
  ) : null;
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">
        {fenceWarning}
        {node}
      </div>
    ) : (
      <div className={card}>
        <p className="mb-3 text-sm font-semibold">
          {L("In Today", "Hadir hari ini")}
        </p>
        {fenceWarning}
        {node}
      </div>
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No one checked in today.", "Tiada sesiapa daftar masuk hari ini.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? "overflow-y-auto" : "max-h-80 space-y-3 overflow-y-auto pr-1"
      }
    >
      {data.map((u) => (
        <div
          key={u.id}
          className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "pb-2"}`}
        >
          <p className="text-sm font-medium">{u.name}</p>
          {/* v1.15.0 fix (audit finding): in_at is a UTC string — slicing it
              showed a 10:00 MYT clock-in as 02:00. mytTime converts. */}
          <p className="text-muted-foreground text-xs">
            {L("Checked in at", "Daftar masuk pada")}{" "}
            {u.in_at ? mytTime(u.in_at) : L("unknown", "tidak diketahui")}
            {(() => {
              /* v1.21.0 allow-but-flag: staff outside the fence show RED
                 ("outside office"); CEO/COO/CCO are exempt from the flag —
                 their distance shows neutrally. Missing location on a staff
                 punch is amber (older rows predate the requirement). */
              const g = gpsLabel(u.in_gps, fence);
              const exempt = GEOFENCE_EXEMPT_ROLES.includes(u.role ?? "");
              if (g.ok === null)
                return (
                  <span
                    className={`ml-1.5 font-medium ${exempt ? "opacity-60" : "text-warning"}`}
                  >
                    · {g.text}
                  </span>
                );
              if (exempt)
                return (
                  <span className="ml-1.5 font-medium opacity-60">
                    · {g.text}
                  </span>
                );
              return g.ok ? (
                <span className="text-success ml-1.5 font-medium">
                  · {L("at office", "di pejabat")} · {g.text}
                </span>
              ) : (
                <span className="text-danger ml-1.5 font-semibold">
                  · {L("OUTSIDE OFFICE", "LUAR PEJABAT")} · {g.text}
                </span>
              );
            })()}
          </p>
        </div>
      ))}
    </div>
  );
}

function OutstandingDocsSummary({ kind }: { kind: "INV" | "QT" }) {
  const [data, setData] = useState<SalesDoc[]>([]);
  useEffect(() => {
    void api<{ docs: SalesDoc[] }>("/staff/docs").then(
      (r) =>
        r.ok &&
        r.data &&
        setData(
          r.data.docs.filter(
            (d) => d.doc_type === kind && d.payment_status !== "paid"
          )
        )
    );
  }, [kind]);
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L(
          `No ${kind === "INV" ? "unpaid invoices" : "open quotations"}.`,
          kind === "INV"
            ? "Tiada invois belum dibayar."
            : "Tiada sebut harga terbuka."
        )}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((d) => (
        <div
          key={d.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <span className="text-sm font-medium">
            {d.doc_number}{" "}
            <span className="text-muted-foreground font-normal">
              ({d.company})
            </span>
          </span>
          <span className="font-bold text-red-600 tabular-nums">
            {fmtRM(d.total_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PendingLeaveSummary() {
  const [data, setData] = useState<LeaveReq[]>([]);
  useEffect(() => {
    void api<{ leave: LeaveReq[] }>("/staff/leave?all=1").then(
      (r) =>
        r.ok &&
        r.data &&
        setData(r.data.leave.filter((l) => l.status === "pending"))
    );
  }, []);
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No pending leave requests.", "Tiada permohonan cuti menunggu.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((l) => (
        <div
          key={l.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {l.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className="text-muted-foreground font-normal">
              ({l.days} {L("days", "hari")})
            </span>
          </p>
          <p className="text-muted-foreground text-xs">
            {l.start_date} {L("to", "hingga")} {l.end_date}
          </p>
        </div>
      ))}
    </div>
  );
}

function PendingClaimsSummary() {
  const [data, setData] = useState<
    {
      id: number;
      user_name: string;
      category: string;
      amount_cents: number;
      status: string;
    }[]
  >([]);
  useEffect(() => {
    void api<{
      claims: {
        id: number;
        user_name: string;
        category: string;
        amount_cents: number;
        status: string;
      }[];
    }>("/staff/claims").then(
      (r) =>
        r.ok &&
        r.data &&
        setData(r.data.claims.filter((c) => c.status === "pending"))
    );
  }, []);
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No pending claims.", "Tiada tuntutan menunggu.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((c) => (
        <div
          key={c.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {c.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className="text-muted-foreground font-normal">
              - {c.category}
            </span>
          </p>
          <span className="font-bold tabular-nums">
            {fmtRM(c.amount_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LowStockSummary() {
  const [data, setData] = useState<
    { id: number; name: string; sku: string; stock: number }[]
  >([]);
  useEffect(() => {
    void api<{
      items: { id: number; name: string; sku: string; stock: number }[];
    }>("/staff/inventory").then(
      (r) =>
        r.ok &&
        r.data &&
        r.data.items &&
        setData(r.data.items.filter((i) => (i.stock || 0) <= 5))
    );
  }, []);
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No low stock items.", "Tiada barang stok rendah.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((i) => (
        <div
          key={i.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {i.name}{" "}
            <span className="text-muted-foreground font-normal">({i.sku})</span>
          </p>
          <span className="font-bold text-red-600 tabular-nums">
            {L(`${i.stock} left`, `baki ${i.stock}`)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TradingDesk({
  user,
  go,
  lang = "en",
}: {
  user: User;
  go?: (t: TabName) => void;
  lang?: Lang;
}) {
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const [rev, setRev] = useState<RevenueData | null>(null);
  const [sum, setSum] = useState<DashSummary | null>(null);
  const [mkLines, setMkLines] = useState<RevLineLite[] | null>(null);
  const [hours, setHours] = useState<HourBucket[] | null>(null);
  const canRevenue = REVENUE_ROLES.includes(user.role);
  const canStatus = [
    "super_admin",
    "admin",
    "ceo",
    "coo",
    "cco",
    "hr_admin",
  ].includes(user.role);
  // v1.6.1 (CEO): the monthly KPI target is set right here on the dashboard,
  // and only these three roles may change it.
  const canEditKpi = ["super_admin", "ceo", "coo"].includes(user.role);
  const [editingKpi, setEditingKpi] = useState(false);
  const [kpiDraft, setKpiDraft] = useState("");
  const { show: showKpiToast, node: kpiToastNode } = useSaveToast();
  /* v1.25.0 — remembered-first (CEO chose "instant everywhere, mark money"):
     the ticker paints its last known figures the moment the tab opens and
     shows an "updating…" dot until the fresh numbers land, so nobody reads a
     stale amount as final. Cache is per-account and expires after 24h. */
  const revCache = useCachedApi<RevenueData>(
    canRevenue ? "/staff/revenue" : null,
    canRevenue
  );
  const sumCache = useCachedApi<DashSummary>("/staff/dashboard/summary");
  const moneyStale = revCache.stale || sumCache.stale;
  useEffect(() => {
    if (revCache.data) setRev(revCache.data);
  }, [revCache.data]);
  useEffect(() => {
    if (sumCache.data) setSum(sumCache.data);
  }, [sumCache.data]);
  const loadRev = revCache.refresh;
  useEffect(() => {
    if (canRevenue) {
      void api<{ lines: RevLineLite[] }>(`/staff/revenue/lines`).then((r) => {
        if (r.ok && r.data) setMkLines(r.data.lines);
      });
      void api<{ buckets: HourBucket[] }>(`/staff/sales/by-hour`).then((r) => {
        if (r.ok && r.data) setHours(r.data.buckets);
      });
    }
  }, [canRevenue]);

  const saveKpi = async () => {
    const v = Number(kpiDraft);
    if (!rev) return;
    if (!v || v <= 0) {
      showKpiToast(
        L("No change", "Tiada perubahan"),
        L("Enter a target amount first", "Masukkan amaun sasaran dahulu"),
        "notice"
      );
      return;
    }
    const res = await api(`/staff/revenue/target`, {
      method: "POST",
      body: JSON.stringify({
        month: rev.month,
        target_cents: Math.round(v * 100),
      }),
    });
    if (res.ok) {
      showKpiToast(
        L("Saved", "Disimpan"),
        L(
          `Monthly KPI target — ${fmtRM(Math.round(v * 100))}`,
          `Sasaran KPI bulanan — ${fmtRM(Math.round(v * 100))}`
        )
      );
      setEditingKpi(false);
      loadRev();
    }
  };

  /* ---- shared derived figures ---- */
  const monthTotal = rev
    ? rev.tiktok.this_cents +
      rev.invoiced.this_cents +
      (rev.other?.this_cents ?? 0) +
      (rev.manual?.this_cents ?? 0)
    : 0;
  const lastTotal = rev
    ? rev.tiktok.last_cents +
      rev.invoiced.last_cents +
      (rev.other?.last_cents ?? 0) +
      (rev.manual?.last_cents ?? 0)
    : 0;
  // Manual target (set on the Ecommerce tab) wins; otherwise auto from history.
  const autoT = autoTargetCents(lastTotal);
  const target = rev?.target_cents || autoT;
  const targetIsAuto = !rev?.target_cents && !!autoT;
  const nowM = new Date(Date.now() + 8 * 3600 * 1000);
  const daysInMonth = new Date(
    Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const dayOfMonth = nowM.getUTCDate();
  const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const pct = target ? Math.round((monthTotal / target) * 100) : null;
  const onPace = pct !== null && pct >= expectedPct;

  /* ---- ticker cards ---- */
  const ticker: ReactNode[] = [];
  if (canRevenue && rev?.today) {
    const t = rev.today;
    const todayTotal =
      t.tiktok_cents +
      t.invoiced_cents +
      (t.other_cents ?? 0) +
      (t.manual_cents ?? 0);
    const y = rev.yesterday?.total_cents ?? 0;
    const up = todayTotal >= y;
    ticker.push(
      <div key="today" className="bg-brand rounded-xl p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">
          🔥 {tr("Today's sales · LIVE", lang)}
        </p>
        <p className="mt-1 text-2xl leading-tight font-bold tabular-nums">
          {fmtRM(todayTotal)}
        </p>
        {(todayTotal > 0 || y > 0) && (
          <p
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${up ? "bg-bull/25 text-green-200" : "bg-bear/25 text-red-200"}`}
          >
            {up ? "▲" : "▼"} {fmtRM(Math.abs(todayTotal - y))}{" "}
            {tr("vs yesterday", lang)}
          </p>
        )}
        <p className="mt-1 text-xs text-white/80">
          {lang === "ms"
            ? `${t.tiktok_orders} ${tr("TikTok orders", lang)}`
            : `${t.tiktok_orders} TikTok order${t.tiktok_orders === 1 ? "" : "s"}`}
          {t.invoiced_cents > 0
            ? ` · ${lang === "ms" ? "invois" : "invoiced"} ${fmtRM(t.invoiced_cents)}`
            : ""}
        </p>
      </div>
    );
  }
  if (canRevenue && rev) {
    ticker.push(
      <StatCard
        key="month"
        label={`${tr("Revenue", lang)} — ${ym(rev.month)}`}
        value={fmtRM(monthTotal)}
        bar={
          target
            ? {
                pct: (monthTotal / target) * 100,
                label: `${Math.round((monthTotal / target) * 100)}% ${lang === "ms" ? "daripada" : "of"} ${fmtRM(target)} ${tr(targetIsAuto ? "auto-target" : "target", lang)}`,
                tone: monthTotal >= target ? "green" : "gold",
              }
            : undefined
        }
        sub={
          target
            ? undefined
            : lang === "ms"
              ? "bulan pertama data — sasaran auto bermula bulan depan"
              : "first month of data — the auto-target starts next month"
        }
      />
    );
    if (rev.overall && rev.overall.total_cents > 0) {
      const ov = rev.overall;
      const best = ov.best;
      const thisMonthCents =
        ov.months.find((m) => m.month === rev.month)?.cents ?? 0;
      ticker.push(
        <StatCard
          key="overall"
          label={`📈 ${tr("All-time — every channel", lang)}`}
          value={fmtRM(ov.total_cents)}
          bar={
            best && best.cents > 0
              ? {
                  pct: (thisMonthCents / best.cents) * 100,
                  label:
                    best.month === rev.month
                      ? tr("this month is your best yet 🏆", lang)
                      : `${tr("vs best month", lang)} (${ym(best.month)} · ${fmtRM(best.cents)})`,
                  tone: thisMonthCents >= best.cents ? "green" : "navy",
                }
              : undefined
          }
          sub={
            lang === "ms"
              ? `${ov.months.length} ${tr("months of business", lang)}`
              : `${ov.months.length} month${ov.months.length === 1 ? "" : "s"} of business`
          }
        />
      );
    }
  }
  // v1.6.1 (CEO): "Needs attention" sits in the top ticker row, right beside
  // the All-time card (position 4), instead of a separate strip at the bottom.
  if (canStatus && sum) {
    const rows: [string, number | null, TabName][] = [
      ["Leave pending", sum.pending_leave, "HR"],
      ["Claims pending", sum.pending_claims, "Claims"],
      ["OT pending", sum.pending_ot, "Attendance"],
      ["Low stock", sum.low_stock, "Inventory"],
      ["Quotations open", sum.open_quotations, "Sales"],
    ];
    const shown = rows.filter(([, v]) => v !== null && v > 0);
    ticker.push(
      <div
        key="attention"
        className="border-border bg-card border-t-brand rounded-xl border border-t-2 p-4 shadow-sm"
      >
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {tr("Needs attention", lang)}
        </p>
        {shown.length === 0 ? (
          <p className="mt-2 text-sm">
            ✅ {tr("Nothing waiting on you", lang)}
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {/* v1.23.2: translate ONLY the display — setDetailModal keeps
                  the EN key, which the modal switch below compares against. */}
            {shown.map(([label, v, _tabName]) => (
              <button
                type="button"
                key={label}
                onClick={() => setDetailModal(label)}
                className="hover:text-primary flex w-full items-baseline justify-between text-sm hover:underline"
              >
                <span>{tr(label, lang)}</span>
                <span className="font-bold tabular-nums">{v}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  // Unpaid invoices card comes last (only when there are any) so it never
  // pushes "Needs attention" out of the top row.
  if (canRevenue && rev?.outstanding && rev.outstanding.docs > 0) {
    ticker.push(
      <StatCard
        key="out"
        accent="red"
        label={L("Unpaid invoices", "Invois belum dibayar")}
        value={fmtRM(rev.outstanding.cents)}
        sub={L(
          `${rev.outstanding.docs} invoice${rev.outstanding.docs === 1 ? "" : "s"} awaiting payment — collect first`,
          `${rev.outstanding.docs} invois menunggu bayaran — kutip dahulu`
        )}
      />
    );
  }

  /* ---- market targets: product vs service ---- */
  const thisM = rev?.month ?? "";
  const lastM = rev?.last_month ?? "";
  const markets = (mkLines ?? [])
    .map((l) => {
      const now = l.months.find((m) => m.month === thisM)?.cents ?? 0;
      const last = l.months.find((m) => m.month === lastM)?.cents ?? 0;
      const t = autoTargetCents(last);
      return {
        key: l.key,
        label: l.label.split(" (")[0] ?? l.key,
        now,
        last,
        target: t,
      };
    })
    .filter((m) => m.now > 0 || m.last > 0);

  /* ---- motivation ---- */
  let motivation: { emoji: string; text: string; cls: string } | null = null;
  if (canRevenue && rev && target && pct !== null) {
    const daysLeft = Math.max(1, daysInMonth - dayOfMonth);
    const needPerDay = Math.max(0, target - monthTotal) / daysLeft;
    if (pct >= 100) {
      motivation = {
        emoji: "🏆",
        text: L(
          `TARGET SMASHED — ${fmtRM(monthTotal)} against ${fmtRM(target)}. Every ringgit from here is a new record. Set the bar higher!`,
          `SASARAN DIPECAHKAN — ${fmtRM(monthTotal)} berbanding ${fmtRM(target)}. Setiap ringgit dari sini adalah rekod baharu. Naikkan lagi sasaran!`
        ),
        cls: "bg-success-soft text-success",
      };
    } else if (onPace) {
      motivation = {
        emoji: "✅",
        text: L(
          `On pace — day ${dayOfMonth}/${daysInMonth} expects ~${expectedPct}%, you're at ${pct}%. Hold this rhythm and the month is yours.`,
          `Ikut rentak — hari ${dayOfMonth}/${daysInMonth} menjangka ~${expectedPct}%, anda di ${pct}%. Kekalkan rentak ini dan bulan ini milik anda.`
        ),
        cls: "bg-success-soft text-success",
      };
    } else if (expectedPct - pct <= 15) {
      motivation = {
        emoji: "⚡",
        text: L(
          `Push time — ${pct}% done, pace says ${expectedPct}%. ${fmtRM(Math.round(needPerDay))} a day for the next ${daysLeft} day${daysLeft === 1 ? "" : "s"} closes the gap. One good LIVE changes this.`,
          `Masa untuk berusaha — ${pct}% dicapai, rentak sepatutnya ${expectedPct}%. ${fmtRM(Math.round(needPerDay))} sehari untuk ${daysLeft} hari seterusnya menutup jurang. Satu LIVE yang baik boleh mengubahnya.`
        ),
        cls: "bg-warning-soft text-warning",
      };
    } else {
      motivation = {
        emoji: "🚀",
        text: L(
          `Comeback mode — ${fmtRM(Math.max(0, target - monthTotal))} to go. Break it down: that's ${fmtRM(Math.round(needPerDay))} a day. Book the lives, chase the quotes, move the stock.`,
          `Mod bangkit semula — ${fmtRM(Math.max(0, target - monthTotal))} lagi. Pecahkan: itu ${fmtRM(Math.round(needPerDay))} sehari. Jadualkan LIVE, kejar sebut harga, gerakkan stok.`
        ),
        cls: "bg-danger-soft text-danger",
      };
    }
  }

  /* ---- data-driven boost suggestions ---- */
  const tips: string[] = [];
  if (canRevenue && rev) {
    const peak = (hours ?? []).reduce<HourBucket | null>(
      (a, b) => (b.cents > (a?.cents ?? 0) ? b : a),
      null
    );
    if (peak && peak.cents > 0) {
      tips.push(
        L(
          `Schedule the next LIVE at ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00 — your best-selling hour this week (${fmtRM(peak.cents)} across ${peak.orders} orders).`,
          `Jadualkan LIVE seterusnya pada ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00 — jam jualan terbaik anda minggu ini (${fmtRM(peak.cents)} daripada ${peak.orders} pesanan).`
        )
      );
    }
    if (rev.outstanding && rev.outstanding.docs > 0) {
      tips.push(
        L(
          `Chase the ${rev.outstanding.docs} unpaid invoice${rev.outstanding.docs === 1 ? "" : "s"} (${fmtRM(rev.outstanding.cents)}) — it's revenue you already earned.`,
          `Kejar ${rev.outstanding.docs} invois belum dibayar (${fmtRM(rev.outstanding.cents)}) — itu hasil yang anda sudah peroleh.`
        )
      );
    }
    if ((sum?.open_quotations ?? 0) > 0) {
      tips.push(
        L(
          `${sum!.open_quotations} quotation${sum!.open_quotations === 1 ? "" : "s"} still open — a follow-up call today converts faster than a new lead.`,
          `${sum!.open_quotations} sebut harga masih terbuka — panggilan susulan hari ini lebih cepat bertukar jualan daripada prospek baharu.`
        )
      );
    }
    if ((sum?.low_stock ?? 0) > 0) {
      tips.push(
        L(
          `${sum!.low_stock} item${sum!.low_stock === 1 ? "" : "s"} low on stock — restock before the next live so a bestseller never sells out mid-stream.`,
          `${sum!.low_stock} barang stok rendah — tambah stok sebelum LIVE seterusnya supaya barang laris tidak habis di tengah siaran.`
        )
      );
    }
    const weakest = markets
      .filter((m) => m.target && m.now < m.target)
      .sort((a, b) => a.now / a.target! - b.now / b.target!)[0];
    if (weakest?.target) {
      tips.push(
        L(
          `${weakest.label} is at ${Math.round((weakest.now / weakest.target) * 100)}% of its market target — ${fmtRM(weakest.target - weakest.now)} more takes it home.`,
          `${weakest.label} berada pada ${Math.round((weakest.now / weakest.target) * 100)}% daripada sasaran pasarannya — ${fmtRM(weakest.target - weakest.now)} lagi untuk mencapainya.`
        )
      );
    }
  }

  if (ticker.length === 0 && !canStatus) return null;

  // v1.8.0: peak selling hour (reference "Peak activity time") from the
  // by-hour data this component already loads.
  const peakBucket = (hours ?? []).reduce<HourBucket | null>(
    (a, b) => (b.cents > (a?.cents ?? 0) ? b : a),
    null
  );
  const nowMY = new Date(Date.now() + 8 * 3600 * 1000);
  const WEEKDAYS = DAY_NAMES[lang];
  return (
    <div className="space-y-3 md:space-y-4">
      {kpiToastNode}
      {/* v1.8.0 greeting (reference: "Hello, Sarah!") */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          {tr("Hello", lang)}, {firstName(user.name)}! 👋
        </h2>
        <p className="text-muted-foreground flex items-center gap-2 text-xs md:text-sm">
          {/* v1.25.0: sits directly above the money ticker, so "updating…"
              clearly belongs to the figures underneath it. */}
          <StaleHint show={moneyStale} />
          {WEEKDAYS[nowMY.getUTCDay()]}, {dmy(nowMY.toISOString().slice(0, 10))}
        </p>
      </div>
      {/* Zone 1 — the ticker (Today · Revenue · All-time · Needs attention) */}
      {ticker.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{ticker}</div>
      )}

      {/* v1.7.0 company pulse — one compact strip of live counters. */}
      {canStatus &&
        sum &&
        (() => {
          const cashIn = sum.cash_in_cents ?? 0;
          const cashOut = sum.cash_out_cents ?? 0;
          const net = cashIn - cashOut;
          /* label = the EN modal-routing key (NEVER translated); show = display only. */
          const tiles: {
            label: string;
            show?: string;
            value: ReactNode;
            tone?: string;
            tab?: TabName;
          }[] = [
            {
              label: "Clients",
              show: L("Clients", "Pelanggan"),
              value: sum.clients ?? 0,
              tab: "Sales",
            },
            {
              label: "Active stokis",
              show: L("Active stokis", "Stokis aktif"),
              value: sum.active_stokis ?? 0,
              tab: "Stokis",
            },
            {
              label: "Lives today",
              show: L("Lives today", "LIVE hari ini"),
              value: sum.lives_today ?? 0,
              tab: "Attendance",
            },
            {
              label: "In today",
              show: L("In today", "Hadir hari ini"),
              value: sum.attendance_today ?? 0,
              tab: "Attendance",
            },
            {
              label: "Unpaid inv.",
              show: L("Unpaid inv.", "Inv. belum bayar"),
              value: sum.outstanding_invoices ?? 0,
              tab: "Sales",
            },
            {
              label: "Cash flow (mo)",
              show: L("Cash flow (mo)", "Aliran tunai (bln)"),
              value: (
                <span className={net >= 0 ? "text-bull" : "text-bear"}>
                  {net >= 0 ? "" : "−"}
                  {fmtRM(Math.abs(net))}
                </span>
              ),
              tab: "Finance",
            },
            // v1.8.0 (reference "Peak activity time"): the week's best-selling hour
            ...(peakBucket && peakBucket.cents > 0
              ? [
                  {
                    label: "Peak hour (wk)",
                    show: L("Peak hour (wk)", "Jam puncak (mgu)"),
                    value: (
                      <span className="whitespace-nowrap">
                        {String(peakBucket.hour).padStart(2, "0")}–
                        {String((peakBucket.hour + 1) % 24).padStart(2, "0")}
                      </span>
                    ),
                    tab: "Ecommerce" as TabName,
                  },
                ]
              : []),
          ];
          return (
            <div
              className={`grid grid-cols-3 gap-2 ${tiles.length > 6 ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-6"}`}
            >
              {tiles.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setDetailModal(t.label)}
                  className="border-border bg-card hover:border-primary flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-colors"
                >
                  <p className="text-lg leading-tight font-bold tabular-nums">
                    {t.value}
                  </p>
                  <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {t.show ?? t.label}
                  </p>
                </button>
              ))}
            </div>
          );
        })()}

      {/* Zone 2+3 — KPI + markets, one desk card */}
      {canRevenue && rev && (target || markets.length > 0 || canEditKpi) && (
        <div className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              📊 {L("Sales floor", "Lantai jualan")} — {ym(rev.month)}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {L("day", "hari")} {dayOfMonth}/{daysInMonth} ·{" "}
              {L("pace", "rentak")} {expectedPct}%
            </p>
          </div>

          {/* v1.6.1: set/edit the monthly KPI target right here (CEO/COO/super). */}
          {editingKpi ? (
            <div className="border-border mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">
                {L("Target for", "Sasaran untuk")} {ym(rev.month)}:
              </span>
              <span className="flex items-center gap-1 text-sm">
                RM
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  autoFocus
                  className="border-input bg-background h-9 w-36 rounded-lg border px-2 text-sm"
                  placeholder={L("e.g. 35000", "cth. 35000")}
                  value={kpiDraft}
                  onChange={(e) => setKpiDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveKpi();
                    if (e.key === "Escape") setEditingKpi(false);
                  }}
                />
              </span>
              <button
                type="button"
                className={btnSmPrimary}
                onClick={() => void saveKpi()}
              >
                {L("Save target", "Simpan sasaran")}
              </button>
              <button
                type="button"
                className="text-muted-foreground text-xs underline"
                onClick={() => setEditingKpi(false)}
              >
                {L("Cancel", "Batal")}
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold tracking-wide uppercase">
                  🎯 {L("KPI — month target", "KPI — sasaran bulan")}{" "}
                  {target
                    ? targetIsAuto
                      ? L("(auto: last month +10%)", "(auto: bulan lepas +10%)")
                      : ""
                    : ""}
                </span>
                <span className="flex items-baseline gap-2">
                  {target ? (
                    <span className="font-bold tabular-nums">
                      {fmtRM(monthTotal)} / {fmtRM(target)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {L("no target set", "tiada sasaran ditetapkan")}
                    </span>
                  )}
                  {canEditKpi && (
                    <button
                      type="button"
                      className="text-gold-deep text-xs font-medium underline"
                      onClick={() => {
                        setKpiDraft(
                          rev.target_cents
                            ? (rev.target_cents / 100).toString()
                            : target
                              ? (target / 100).toString()
                              : ""
                        );
                        setEditingKpi(true);
                      }}
                    >
                      {rev.target_cents
                        ? L("Edit target", "Sunting sasaran")
                        : L("Set target", "Tetapkan sasaran")}
                    </button>
                  )}
                </span>
              </div>
              {target && pct !== null && (
                <div className="bg-secondary relative mt-1.5 h-5 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-bull" : pct >= 70 ? "bg-gold-solid" : pct >= 40 ? "bg-warning" : "bg-bear"}`}
                    style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }}
                  />
                  {/* pace marker: where the month says you SHOULD be */}
                  <div
                    className="bg-foreground/60 absolute inset-y-0 w-0.5"
                    style={{ left: `${Math.min(99, expectedPct)}%` }}
                    title={L(
                      `pace: ${expectedPct}%`,
                      `rentak: ${expectedPct}%`
                    )}
                  />
                  <span
                    className={`absolute inset-0 flex items-center text-[11px] font-bold ${pct >= 12 ? "justify-start pl-2 text-white" : "text-foreground justify-start"}`}
                    style={
                      pct < 12
                        ? { paddingLeft: `calc(${Math.max(pct, 1)}% + 6px)` }
                        : undefined
                    }
                  >
                    {pct}%
                  </span>
                </div>
              )}
              {!target && canEditKpi && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {L(
                    "Set this month's KPI target to turn on the progress bar and the pace tracker.",
                    "Tetapkan sasaran KPI bulan ini untuk menghidupkan bar kemajuan dan penjejak rentak."
                  )}
                </p>
              )}
            </div>
          )}
          {motivation && (
            <p
              className={`mt-2.5 rounded-lg px-3 py-2 text-xs font-medium ${motivation.cls}`}
            >
              {motivation.emoji} {motivation.text}
            </p>
          )}
          {markets.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                {L(
                  "Market targets — product · service",
                  "Sasaran pasaran — produk · perkhidmatan"
                )}
              </p>
              <div className="mt-1.5 space-y-2">
                {markets.map((m) => {
                  const mPct = m.target
                    ? Math.round((m.now / m.target) * 100)
                    : null;
                  return (
                    <div
                      key={m.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="w-24 shrink-0 capitalize md:w-32">
                        {m.label}
                      </span>
                      <div className="flex-1">
                        <MiniBar
                          pct={
                            m.target
                              ? (m.now / m.target) * 100
                              : m.now > 0
                                ? 100
                                : 0
                          }
                          tone={
                            mPct !== null && mPct >= 100
                              ? "green"
                              : m.key === "service"
                                ? "gold"
                                : "navy"
                          }
                        />
                      </div>
                      <span className="shrink-0 text-right text-xs tabular-nums md:text-sm">
                        <span className="font-semibold">{fmtRM(m.now)}</span>
                        {m.target && (
                          <span className="text-muted-foreground">
                            {" "}
                            / {fmtRM(m.target)} ({mPct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {L(
                  "Each line's target = its own last month + 10% (auto). Momentum, per business.",
                  "Sasaran setiap bidang = bulan lepasnya sendiri + 10% (auto). Momentum, mengikut perniagaan."
                )}
              </p>
            </div>
          )}
          {tips.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                💡 {L("Boost the number", "Tingkatkan angka")}
              </p>
              <ul className="mt-1.5 space-y-1">
                {tips.slice(0, 4).map((t) => (
                  <li key={t} className="flex gap-2 text-xs">
                    <span aria-hidden className="text-gold-deep">
                      ▸
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* v1.8.0 — reference-design cards: attendance donut · today's
          assignments · month-by-month bars. */}
      {canStatus && (
        /* v1.23.3: [&>*]:min-w-0 — grid tracks are minmax(auto,1fr); one
           wide child (the assignments table was 386px min) stretches the
           track past the phone and pans the WHOLE page. Never again. */
        <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {sum && (
            <AttendanceDonutCard
              onTime={sum.attendance_on_time ?? 0}
              late={sum.attendance_late ?? 0}
              staffTotal={sum.staff_total ?? 0}
              onOpen={() => setDetailModal("In today")}
            />
          )}
          <TodayAssignmentsCard
            onOpenRoster={go ? () => go("Attendance") : undefined}
            canManage={[
              "ceo",
              "coo",
              "cco",
              "hr_admin",
              "super_admin",
              "admin",
            ].includes(user.role)}
          />
          {canRevenue && rev?.overall && rev.overall.months.length > 1 && (
            <MonthlyBarsCard months={rev.overall.months} />
          )}
        </div>
      )}

      {detailModal && (
        <div
          className="animate-in fade-in fixed inset-0 z-[100] flex flex-col items-center justify-end overflow-hidden bg-black/60 backdrop-blur-sm transition-all sm:justify-center sm:p-6"
          onClick={() => setDetailModal(null)}
        >
          <div
            className="bg-background animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:zoom-in-95 relative flex max-h-[90vh] w-full flex-col rounded-t-2xl shadow-2xl sm:max-w-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-muted/20 flex shrink-0 items-center justify-between rounded-t-2xl border-b px-4 py-3 sm:rounded-t-2xl sm:px-5 sm:py-4">
              <h2 className="text-lg font-bold">
                {L(
                  detailModal,
                  (
                    {
                      Clients: "Pelanggan",
                      "Active stokis": "Stokis aktif",
                      "Lives today": "LIVE hari ini",
                      "In today": "Hadir hari ini",
                      "Unpaid inv.": "Inv. belum bayar",
                      "Cash flow (mo)": "Aliran tunai (bln)",
                      "Peak hour (wk)": "Jam puncak (mgu)",
                      "Leave pending": "Cuti menunggu",
                      "Claims pending": "Tuntutan menunggu",
                      "OT pending": "OT menunggu",
                      "Low stock": "Stok rendah",
                      "Quotations open": "Sebut harga terbuka",
                    } as Record<string, string>
                  )[detailModal] ?? detailModal
                )}
              </h2>
              <button
                type="button"
                className="bg-secondary hover:bg-muted rounded-full p-2"
                onClick={() => setDetailModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="relative w-full overflow-y-auto">
              {detailModal === "Clients" && <ClientsCard inModal />}
              {detailModal === "Active stokis" && <ActiveStokisSummary />}
              {detailModal === "Lives today" && (
                <LiveScheduleCard user={user} inModal />
              )}
              {detailModal === "In today" && <InTodaySummary />}
              {detailModal === "Unpaid inv." && (
                <OutstandingDocsSummary kind="INV" />
              )}
              {detailModal === "Cash flow (mo)" && <PnlCard inModal />}
              {detailModal === "Peak hour (wk)" && <SalesByHourCard />}

              {detailModal === "Leave pending" && <PendingLeaveSummary />}
              {detailModal === "Claims pending" && <PendingClaimsSummary />}
              {detailModal === "OT pending" && <OtApprovalsCard inModal />}
              {detailModal === "Low stock" && <LowStockSummary />}
              {detailModal === "Quotations open" && (
                <OutstandingDocsSummary kind="QT" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SalesRevenueCard() {
  const [rev, setRev] = useState<RevenueData | null>(null);
  const loadRev = useCallback(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => {
      if (r.ok && r.data) setRev(r.data);
    });
  }, []);
  useEffect(() => {
    loadRev();
  }, [loadRev]);
  if (!rev) return null;
  const rm = fmtRM; // v1.4.272: the global — a money figure must never render two ways
  // v1.4.169 (CEO: "everything count correctly and accurately"): total sales
  // = TikTok + paid invoices + non-TikTok shipments + manual sales. The KPI
  // progress below uses this same total, so the target tracks EVERY channel.
  const total =
    rev.tiktok.this_cents +
    rev.invoiced.this_cents +
    (rev.other?.this_cents ?? 0) +
    (rev.manual?.this_cents ?? 0);
  const lastTotal =
    rev.tiktok.last_cents +
    rev.invoiced.last_cents +
    (rev.other?.last_cents ?? 0) +
    (rev.manual?.last_cents ?? 0);
  const delta =
    lastTotal > 0 ? Math.round(((total - lastTotal) / lastTotal) * 100) : null;
  const box = (label: string, value: string, sub: string) => (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>
    </div>
  );
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        {L("Sales revenue", "Hasil jualan")} — {rev.month}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "TikTok figures from synced order amounts (returned orders excluded). Invoiced figures count PAYMENTS RECEIVED (paid invoices, in the month the payment landed) — comparable with Expenses. The Total also counts non-TikTok shipments (order amount on the postage form) and manual sales (an Out − with a sold price) — every channel, one number.",
          "Angka TikTok daripada amaun pesanan yang disegerakkan (pesanan dipulangkan dikecualikan). Angka invois mengira BAYARAN DITERIMA (invois dibayar, dalam bulan bayaran diterima) — setanding dengan Perbelanjaan. Jumlah turut mengira penghantaran bukan TikTok (amaun pesanan pada borang pos) dan jualan manual (Out − dengan harga jualan) — semua saluran, satu angka."
        )}
        {/* v1.6.1: the KPI target moved to the Dashboard (set by CEO/COO). */}
      </p>
      {/* v1.4.156 (CEO: "show today sales to motivate my Sales team") —
          today leads the grid with the brand-gold accent. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* v1.4.271 audit: the 🔥 Today box moved OUT of this card — the
            hero band above owns "today" now; two cards both saying today's
            number was the audit's first finding. This card is the MONTH view. */}
        {box(
          "TikTok Shop",
          rm(rev.tiktok.this_cents),
          L(
            `${rev.tiktok.this_orders} orders · last month ${rm(rev.tiktok.last_cents)}`,
            `${rev.tiktok.this_orders} pesanan · bulan lepas ${rm(rev.tiktok.last_cents)}`
          )
        )}
        {box(
          L("Invoiced (paid)", "Invois (dibayar)"),
          rm(rev.invoiced.this_cents),
          L(
            `${rev.invoiced.this_docs} paid · last month ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · outstanding ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`,
            `${rev.invoiced.this_docs} dibayar · bulan lepas ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · tertunggak ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`
          )
        )}
        {/* v1.4.169: the other two channels, so the Total is ALL sales */}
        {box(
          L("Other shipments", "Penghantaran lain"),
          rm(rev.other?.this_cents ?? 0),
          L(
            `${rev.other?.this_orders ?? 0} non-TikTok order${(rev.other?.this_orders ?? 0) === 1 ? "" : "s"} with amount · last month ${rm(rev.other?.last_cents ?? 0)}`,
            `${rev.other?.this_orders ?? 0} pesanan bukan TikTok dengan amaun · bulan lepas ${rm(rev.other?.last_cents ?? 0)}`
          )
        )}
        {box(
          L("Manual sales", "Jualan manual"),
          rm(rev.manual?.this_cents ?? 0),
          L(
            `${rev.manual?.this_units ?? 0} unit${(rev.manual?.this_units ?? 0) === 1 ? "" : "s"} sold via Out − · last month ${rm(rev.manual?.last_cents ?? 0)}`,
            `${rev.manual?.this_units ?? 0} unit dijual melalui Out − · bulan lepas ${rm(rev.manual?.last_cents ?? 0)}`
          )
        )}
        {box(
          L("Total — all channels", "Jumlah — semua saluran"),
          rm(total),
          delta === null
            ? L(`last month ${rm(lastTotal)}`, `bulan lepas ${rm(lastTotal)}`)
            : L(
                `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`,
                `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% berbanding bulan lepas`
              )
        )}
      </div>
      {/* v1.6.1: last month's KPI result stays as context; the editable KPI
          target itself now lives on the Dashboard's Sales Floor. */}
      {rev.last_target_cents
        ? (() => {
            const lastPct = Math.round(
              (lastTotal / rev.last_target_cents!) * 100
            );
            const hit = lastPct >= 100;
            return (
              <p
                className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${hit ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
              >
                {hit ? "🏆" : "📈"} {L("Last month", "Bulan lepas")} (
                {ym(rev.last_month)}): {rm(lastTotal)} {L("of", "daripada")}{" "}
                {rm(rev.last_target_cents!)} — {lastPct}%{" "}
                {hit
                  ? L(
                      "TARGET HIT — keep the streak going!",
                      "SASARAN DICAPAI — teruskan momentum!"
                    )
                  : L(
                      "— this month is the comeback.",
                      "— bulan ini masa bangkit semula."
                    )}
              </p>
            );
          })()
        : null}
    </div>
  );
}

/* ================= Company events (v1.4.73) ================= */

interface CompanyEvent {
  id: number;
  title: string;
  category: string;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  details?: string | null;
  created_by_name?: string | null;
}

const EVENTS_MANAGE_ROLES = [
  "super_admin",
  "admin",
  "hr_admin",
  "ceo",
  "coo",
  "cco",
];
const EVENT_CATEGORIES = [
  ["training", "Training"],
  ["class", "Class"],
  ["meeting", "Meeting"],
  ["event", "Event"],
] as const;

/** Upcoming events — visible to EVERY staff member on the Dashboard so
    trainings, classes and important dates are never missed. Managers
    (events_manage roles) add and remove events inline; everyone is
    bell-notified when one is created. */
/* v1.5.0: TrendingMYCard + TREND_BUSINESS_KEYWORDS removed with the Social tab. */

function UpcomingEventsCard({ role }: { role: string }) {
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    category: "training",
    event_date: "",
    start_time: "",
    end_time: "",
    location: "",
    details: "",
  });
  // v1.4.76: professional month-calendar view (default) with a list toggle.
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [calMonth, setCalMonth] = useState(
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const canManage = EVENTS_MANAGE_ROLES.includes(role);
  const { show: showToast, node: toastNode } = useSaveToast();

  // v1.4.81: Johor public holidays render on the calendar too.
  const [holidays, setHolidays] = useState<
    { holiday_date: string; name: string; kind: string }[]
  >([]);
  // v1.4.101: staff birthdays render on the calendar + upcoming list — the
  // team sees them coming and can prepare the celebration.
  const [bdays, setBdays] = useState<{ name: string; birthday: string }[]>([]);
  useEffect(() => {
    void api<{ birthdays: { name: string; birthday: string }[] }>(
      `/staff/birthdays-lite`
    ).then((r) => {
      if (r.ok && r.data) setBdays(r.data.birthdays);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const bdayOn = (iso: string) =>
    bdays.filter((b) => b.birthday?.slice(5) === iso.slice(5));

  const loadEvents = useCallback(async () => {
    const res = await api<{ events: CompanyEvent[] }>(`/staff/events`);
    if (res.ok && res.data) setEvents(res.data.events);
  }, []);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    void api<{
      holidays: { holiday_date: string; name: string; kind: string }[];
    }>(`/staff/holidays?year=${calMonth.slice(0, 4)}`).then((r) => {
      if (r.ok && r.data) setHolidays(r.data.holidays);
    });
  }, [calMonth]);

  const todayISO = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const upcoming = events.filter((e) => e.event_date >= todayISO);
  // birthdays in the next 30 days, projected onto this/next year
  const upcomingBdays = bdays
    .map((b) => {
      const md = b.birthday.slice(5);
      let iso = `${todayISO.slice(0, 4)}-${md}`;
      if (iso < todayISO) iso = `${Number(todayISO.slice(0, 4)) + 1}-${md}`;
      return { name: b.name, iso };
    })
    .filter(
      (b) =>
        (new Date(b.iso).getTime() - new Date(todayISO).getTime()) / 86400000 <=
        30
    )
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const daysAway = (iso: string) => {
    const today = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const n = Math.round(
      (new Date(iso).getTime() - new Date(today).getTime()) / 86400000
    );
    return n === 0 ? "TODAY" : n === 1 ? "Tomorrow" : `in ${n} days`;
  };

  const createEvent = async () => {
    if (!draft.title.trim() || !draft.event_date) {
      setMsg(L("Title and date are required.", "Tajuk dan tarikh diperlukan."));
      return;
    }
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(`/staff/events`, {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        start_time: draft.start_time || undefined,
        end_time: draft.end_time || undefined,
        location: draft.location || undefined,
        details: draft.details || undefined,
      }),
    });
    if (!res.ok) {
      setMsg(
        res.data?.error?.message ??
          L("Could not create the event", "Tidak dapat membuat acara")
      );
      return;
    }
    setDraft({
      title: "",
      category: "training",
      event_date: "",
      start_time: "",
      end_time: "",
      location: "",
      details: "",
    });
    setShowForm(false);
    showToast(
      L("Saved", "Disimpan"),
      L(
        "Event created — all staff notified",
        "Acara dibuat — semua kakitangan dimaklumkan"
      )
    );
    void loadEvents();
  };

  const removeEvent = async (id: number) => {
    await api(`/staff/events/${id}`, { method: "DELETE" });
    void loadEvents();
  };

  return (
    <div className={card}>
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {L("Upcoming events", "Acara akan datang")}
            {upcoming.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {upcoming.length}
              </span>
            )}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Trainings, classes and important company dates — everyone is notified when one is added.",
              "Latihan, kelas dan tarikh penting syarikat — semua dimaklumkan apabila satu ditambah."
            )}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span className="border-border inline-flex overflow-hidden rounded-lg border text-xs">
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`px-3 py-1.5 font-medium capitalize ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
                onClick={() => setView(v)}
              >
                {v === "calendar"
                  ? L("calendar", "kalendar")
                  : L("list", "senarai")}
              </button>
            ))}
          </span>
          {canManage && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm
                ? L("Close", "Tutup")
                : L("+ Add event", "+ Tambah acara")}
            </button>
          )}
        </span>
      </div>
      {canManage && showForm && (
        <div className="border-border mt-3 space-y-2 rounded-lg border p-3">
          <Sub t={L("Event title", "Tajuk acara")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. TikTok Live hosting training",
                "cth. Latihan pengacaraan TikTok Live"
              )}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </Sub>
          {/* v1.4.154: standard widths — 2-up grid on phones, capped row from sm: */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Sub t={L("Category", "Kategori")}>
              <select
                className={`${inputClass} sm:max-w-40`}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {EVENT_CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {L(
                      l,
                      (
                        {
                          training: "Latihan",
                          class: "Kelas",
                          meeting: "Mesyuarat",
                          event: "Acara",
                        } as Record<string, string>
                      )[v] ?? l
                    )}
                  </option>
                ))}
              </select>
            </Sub>
            <Sub t={L("Date", "Tarikh")}>
              <input
                type="date"
                className={`${inputClass} sm:max-w-44`}
                value={draft.event_date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, event_date: e.target.value }))
                }
              />
            </Sub>
            <Sub t={L("Start (optional)", "Mula (pilihan)")}>
              <input
                type="time"
                className={`${inputClass} sm:max-w-32`}
                value={draft.start_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_time: e.target.value }))
                }
              />
            </Sub>
            <Sub t={L("End (optional)", "Tamat (pilihan)")}>
              <input
                type="time"
                className={`${inputClass} sm:max-w-32`}
                value={draft.end_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, end_time: e.target.value }))
                }
              />
            </Sub>
          </div>
          <Sub t={L("Location (optional)", "Lokasi (pilihan)")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. HQ meeting room / Google Meet",
                "cth. Bilik mesyuarat HQ / Google Meet"
              )}
              value={draft.location}
              onChange={(e) =>
                setDraft((d) => ({ ...d, location: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Details (optional)", "Butiran (pilihan)")}>
            <textarea
              className={`${inputClass} min-h-16`}
              placeholder={L(
                "Agenda, links, what to prepare",
                "Agenda, pautan, apa yang perlu disediakan"
              )}
              value={draft.details}
              onChange={(e) =>
                setDraft((d) => ({ ...d, details: e.target.value }))
              }
            />
          </Sub>
          {msg && <p className="text-destructive text-xs font-medium">{msg}</p>}
          <button
            type="button"
            className={btnClass}
            onClick={() => void createEvent()}
          >
            {L(
              "Save event — notifies all staff",
              "Simpan acara — memaklumkan semua kakitangan"
            )}
          </button>
        </div>
      )}
      {upcomingBdays.length > 0 && (
        <p className="mt-2 rounded-lg bg-pink-50 px-3 py-2 text-xs font-medium text-pink-800">
          🎂 {L("Coming up:", "Akan tiba:")}{" "}
          {upcomingBdays
            .slice(0, 4)
            .map((b) => `${firstName(b.name)} (${dmy(b.iso)})`)
            .join(" · ")}
          {upcomingBdays.length > 4
            ? L(
                ` +${upcomingBdays.length - 4} more`,
                ` +${upcomingBdays.length - 4} lagi`
              )
            : ""}{" "}
          —{" "}
          {L("time to plan the celebration!", "masa untuk merancang sambutan!")}
        </p>
      )}
      {view === "calendar" && (
        <EventsCalendar
          birthdays={bdays}
          events={events}
          holidays={holidays}
          month={calMonth}
          onMonth={setCalMonth}
          selected={selectedDay}
          onSelect={setSelectedDay}
          canManage={canManage}
          onRemove={(id) => void removeEvent(id)}
          onAdded={(title, how) =>
            showToast(
              how === "opened"
                ? L("Calendar opened", "Kalendar dibuka")
                : how === "stale"
                  ? L("Server needs the update", "Pelayan perlu dikemas kini")
                  : L("Saved", "Disimpan"),
              how === "opened"
                ? L(
                    `${title} — tap Add All (iPhone) or Save (Android) on the page that just opened`,
                    `${title} — tekan Add All (iPhone) atau Save (Android) pada halaman yang baru dibuka`
                  )
                : how === "stale"
                  ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                  : how === "shared"
                    ? L(
                        `${title} — pick Calendar in the share sheet to finish`,
                        `${title} — pilih Kalendar dalam helaian kongsi untuk selesai`
                      )
                    : L(
                        `${title} — calendar file downloaded; open it to add the event`,
                        `${title} — fail kalendar dimuat turun; buka untuk menambah acara`
                      )
            )
          }
        />
      )}
      {view === "list" && (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {upcoming.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {L(
                "No upcoming events scheduled.",
                "Tiada acara akan datang dijadualkan."
              )}
            </p>
          )}
          {upcoming.map((ev) => (
            <div
              key={ev.id}
              className="border-border flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{ev.title}</span>{" "}
                  <span className="bg-secondary rounded-full px-2 py-0.5 text-xs capitalize">
                    {annCatL(ev.category)}
                  </span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {dmy(ev.event_date)}
                  <span
                    className={`ml-1.5 font-semibold ${daysAway(ev.event_date) === "TODAY" ? "text-amber-700" : ""}`}
                  >
                    · {daysAwayL(daysAway(ev.event_date))}
                  </span>
                  {ev.start_time
                    ? ` · ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}`
                    : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </p>
                {ev.details && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ev.details}
                  </p>
                )}
                {ev.created_by_name && (
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {L("Added by", "Ditambah oleh")} {ev.created_by_name}
                  </p>
                )}
              </div>
              <span className={rowActions}>
                {/* v1.4.264: the portal card can only remind people while they
                  are LOOKING at it — the phone's own calendar is what buzzes
                  on the day. Every staff member gets this, not just managers. */}
                <button
                  type="button"
                  className={rowBtn}
                  title={L(
                    "Save this event into your phone's calendar — it carries a reminder the evening before and at the start",
                    "Simpan acara ini ke dalam kalendar telefon anda — ia membawa peringatan pada malam sebelumnya dan pada waktu mula"
                  )}
                  onClick={async () => {
                    const how = await addEventToCalendar(ev);
                    showToast(
                      how === "opened"
                        ? L("Calendar opened", "Kalendar dibuka")
                        : how === "stale"
                          ? L(
                              "Server needs the update",
                              "Pelayan perlu dikemas kini"
                            )
                          : L("Saved", "Disimpan"),
                      how === "opened"
                        ? L(
                            `${ev.title} — tap Add All (iPhone) or Save (Android) on the page that just opened`,
                            `${ev.title} — tekan Add All (iPhone) atau Save (Android) pada halaman yang baru dibuka`
                          )
                        : how === "stale"
                          ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                          : how === "shared"
                            ? L(
                                `${ev.title} — pick Calendar in the share sheet to finish`,
                                `${ev.title} — pilih Kalendar dalam helaian kongsi untuk selesai`
                              )
                            : L(
                                `${ev.title} — calendar file downloaded; open it to add the event`,
                                `${ev.title} — fail kalendar dimuat turun; buka untuk menambah acara`
                              ),
                      how === "stale" ? "notice" : undefined
                    );
                  }}
                >
                  📅 {L("Add to my calendar", "Tambah ke kalendar saya")}
                </button>
                {canManage && (
                  <button
                    type="button"
                    className={rowBtnDanger}
                    onClick={() => void removeEvent(ev.id)}
                  >
                    {L("Remove", "Buang")}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Category dot / accent colours — consistent across dots, chips, agenda. */
const EVENT_COLORS: Record<string, string> = {
  training: "bg-amber-500",
  class: "bg-sky-500",
  meeting: "bg-violet-500",
  event: "bg-emerald-500",
};

/** Month calendar — professional on desktop AND phones: 7-column grid,
    today ringed, category-coloured markers (titles on desktop, dots on
    mobile), tap a day for its agenda below. Weeks start Sunday (MY). */
function EventsCalendar({
  events,
  holidays,
  birthdays = [],
  month,
  onMonth,
  selected,
  onSelect,
  canManage,
  onRemove,
  onAdded,
}: {
  events: CompanyEvent[];
  holidays: { holiday_date: string; name: string; kind: string }[];
  birthdays?: { name: string; birthday: string }[];
  month: string;
  onMonth: (m: string) => void;
  selected: string | null;
  onSelect: (d: string | null) => void;
  canManage: boolean;
  onRemove: (id: number) => void;
  onAdded: (
    title: string,
    how: "opened" | "shared" | "downloaded" | "stale"
  ) => void;
}) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const byDay = (d: string) => events.filter((e) => e.event_date === d);
  const holidayOf = (d: string) => holidays.find((h) => h.holiday_date === d);
  const bdaysOf = (d: string) =>
    birthdays.filter((b) => b.birthday?.slice(5) === d.slice(5)); // month-day match, any year
  const shift = (delta: number) => {
    onSelect(null);
    onMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  };
  const monthLabel =
    getLang() === "ms"
      ? `${MONTH_NAMES.ms[m - 1]} ${y}`
      : first.toLocaleDateString("en-MY", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
  /* v1.21.1 (CEO: "the cell looks like not full cell border line"): pad the
     TAIL to complete weeks too — the last row used to stop at the final day,
     leaving the grid's bottom-right corner as an open notch with no borders. */
  const lived: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const cells: (number | null)[] = [
    ...lived,
    ...Array<null>((7 - (lived.length % 7)) % 7).fill(null),
  ];
  const dayEvents = selected ? byDay(selected) : [];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={L("Previous month", "Bulan sebelumnya")}
          className="border-border hover:bg-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg border"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <button
          type="button"
          aria-label={L("Next month", "Bulan seterusnya")}
          className="border-border hover:bg-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg border"
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>
      <div className="text-muted-foreground mt-2 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide uppercase">
        {(getLang() === "ms"
          ? ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"]
          : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        ).map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      {/* v1.21.1: collapse the inner borders cleanly — every 7th cell drops
          border-r (it met the frame and read as a doubled line) and the last
          week drops border-b, so the frame is the single outer line. */}
      <div className="border-border grid grid-cols-7 overflow-hidden rounded-lg border [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
        {cells.map((d, i) => {
          if (d === null)
            return (
              <div
                key={`x${i}`}
                className="border-border bg-secondary/20 min-h-12 border-r border-b md:min-h-20"
              />
            );
          const dISO = iso(d);
          const evs = byDay(dISO);
          const hol = holidayOf(dISO);
          const isToday = dISO === today;
          const isSel = dISO === selected;
          return (
            <button
              key={dISO}
              type="button"
              onClick={() => onSelect(isSel ? null : dISO)}
              className={`border-border relative min-h-12 overflow-hidden border-r border-b p-1 text-left align-top transition-colors md:min-h-20 md:p-1.5 ${isSel ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] md:text-xs ${isToday ? "bg-primary text-primary-foreground font-bold" : hol ? "font-bold text-red-600" : "font-medium"}`}
              >
                {d}
              </span>
              {hol && (
                <>
                  <span className="mt-0.5 flex md:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  <span
                    className="mt-0.5 hidden truncate rounded bg-red-50 px-1 py-0.5 text-[10px] leading-tight font-medium text-red-700 md:block"
                    title={hol.name}
                  >
                    {hol.name}
                  </span>
                </>
              )}
              {bdaysOf(dISO).length > 0 && (
                <>
                  <span className="mt-0.5 flex md:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />
                  </span>
                  <span
                    className="mt-0.5 hidden truncate rounded bg-pink-50 px-1 py-0.5 text-[10px] leading-tight font-medium text-pink-700 md:block"
                    title={bdaysOf(dISO)
                      .map((b) => b.name)
                      .join(", ")}
                  >
                    🎂 {firstName(bdaysOf(dISO)[0]!.name)}
                    {bdaysOf(dISO).length > 1
                      ? ` +${bdaysOf(dISO).length - 1}`
                      : ""}
                  </span>
                </>
              )}
              {/* Mobile: dots. Desktop: title snippets. */}
              {evs.length > 0 && (
                <>
                  <span className="mt-0.5 flex flex-wrap gap-0.5 md:hidden">
                    {evs.slice(0, 4).map((e) => (
                      <span
                        key={e.id}
                        className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS[e.category] ?? "bg-primary"}`}
                      />
                    ))}
                  </span>
                  <span className="mt-0.5 hidden md:block">
                    {evs.slice(0, 2).map((e) => (
                      <span
                        key={e.id}
                        title={e.title}
                        className="bg-secondary mb-0.5 block truncate rounded px-1 py-0.5 text-[10px] leading-tight"
                      >
                        <span
                          className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${EVENT_COLORS[e.category] ?? "bg-primary"}`}
                        />
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 2 && (
                      <span className="text-muted-foreground block text-[10px]">
                        +{evs.length - 2} {L("more", "lagi")}
                      </span>
                    )}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-[11px]">
        {Object.entries(EVENT_COLORS).map(([k, cls]) => (
          <span key={k} className="inline-flex items-center gap-1 capitalize">
            <span className={`h-2 w-2 rounded-full ${cls}`} />
            {annCatL(k)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          {L("Public holiday", "Cuti umum")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-pink-500" />
          🎂 {L("Birthday", "Hari lahir")}
        </span>
      </div>
      {selected && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-sm font-semibold">
            {dmy(selected)}
            {holidayOf(selected) && (
              <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                🏖 {holidayOf(selected)!.name}
              </span>
            )}
            {bdaysOf(selected).map((b) => (
              <span
                key={b.name}
                className="ml-2 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700"
              >
                🎂{" "}
                {L(
                  `${properName(b.name)}'s birthday`,
                  `Hari lahir ${properName(b.name)}`
                )}
              </span>
            ))}
          </p>
          {dayEvents.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {holidayOf(selected)
                ? L(
                    "Public holiday — no company events.",
                    "Cuti umum — tiada acara syarikat."
                  )
                : L("No events this day.", "Tiada acara pada hari ini.")}
            </p>
          ) : (
            dayEvents.map((ev) => (
              <div
                key={ev.id}
                className="mt-2 flex flex-wrap items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${EVENT_COLORS[ev.category] ?? "bg-primary"}`}
                    />
                    <span className="font-medium">{ev.title}</span>{" "}
                    <span className="bg-secondary rounded-full px-2 py-0.5 text-xs capitalize">
                      {annCatL(ev.category)}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ev.start_time
                      ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}`
                      : L("All day", "Sepanjang hari")}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.created_by_name
                      ? L(
                          ` · added by ${ev.created_by_name}`,
                          ` · ditambah oleh ${ev.created_by_name}`
                        )
                      : ""}
                  </p>
                  {ev.details && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {ev.details}
                    </p>
                  )}
                </div>
                <span className={rowActions}>
                  {/* v1.4.264: same button as the list view — one tap into the
                      phone's own calendar, for every staff member. */}
                  <button
                    type="button"
                    className={rowBtn}
                    title={L(
                      "Save this event into your phone's calendar — it carries a reminder the evening before and at the start",
                      "Simpan acara ini ke dalam kalendar telefon anda — ia membawa peringatan pada malam sebelumnya dan pada waktu mula"
                    )}
                    onClick={async () => {
                      const how = await addEventToCalendar(ev);
                      onAdded(ev.title, how);
                    }}
                  >
                    📅 {L("Add to my calendar", "Tambah ke kalendar saya")}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className={rowBtnDanger}
                      onClick={() => onRemove(ev.id)}
                    >
                      {L("Remove", "Buang")}
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ================= Attendance ================= */

function Attendance({ user }: { user: User }) {
  const [month, setMonth] = useState(
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
  );
  const [records, setRecords] = useState<
    { type: string; created_at: string; name?: string }[]
  >([]);
  const [reportMode, setReportMode] = useState(false);
  // v1.4.80: click a column header to sort; click again to reverse.
  const [sortKey, setSortKey] = useState<"name" | "type" | "time" | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const clickSort = (k: "name" | "type" | "time") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };
  // v1.4.78: report can focus on one staff member.
  const [filterName, setFilterName] = useState("");
  const canReport = MANAGE_ROLES.includes(user.role);
  // v1.4.173 (CEO): today's monitor — who has NOT clocked in / out.
  const [monitor, setMonitor] = useState<{
    date: string;
    staff: {
      id: number;
      name: string;
      role: string;
      employment_status?: string | null;
      in_at?: string | null;
      out_at?: string | null;
    }[];
  } | null>(null);

  useEffect(() => {
    const path =
      reportMode && canReport
        ? `/staff/attendance/report?month=${month}`
        : `/staff/attendance?month=${month}`;
    void api<{ records: typeof records }>(path).then((r) =>
      setRecords(r.data?.records ?? [])
    );
  }, [month, reportMode, canReport]);
  useEffect(() => {
    if (!canReport) return;
    const loadMon = () =>
      void api<NonNullable<typeof monitor>>(`/staff/attendance/monitor`).then(
        (r) => {
          if (r.ok && r.data) setMonitor(r.data);
        }
      );
    loadMon();
    const t = setInterval(loadMon, 120000); // keeps the monitor live through the day
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReport]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* v1.4.173 (CEO: "monitoring of the Staff who is not clock in or
          clock out for me to aware"): today's snapshot, refreshed every two
          minutes — missing punches called out on top, then a compact list. */}
      {canReport &&
        monitor &&
        (() => {
          const hm = (iso?: string | null) => {
            if (!iso) return null;
            const d = new Date(
              new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime() +
                8 * 3600 * 1000
            );
            return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
          };
          const nowMYT = new Date(Date.now() + 8 * 3600 * 1000);
          const isWeekend = [0, 6].includes(nowMYT.getUTCDay());
          const afterShift = nowMYT.getUTCHours() >= 18;
          const notIn = monitor.staff.filter((s) => !s.in_at);
          const stillIn = monitor.staff.filter((s) => s.in_at && !s.out_at);
          return (
            <div className={card}>
              <p className="text-sm font-semibold">
                👁{" "}
                {L("Today's attendance monitor", "Pemantau kehadiran hari ini")}{" "}
                — {dmy(monitor.date)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L(
                  "Live snapshot of every active staff member's punches today (refreshes every 2 minutes).",
                  "Paparan langsung punch setiap kakitangan aktif hari ini (dimuat semula setiap 2 minit)."
                )}
                {isWeekend
                  ? L(
                      " Weekend — missing punches are normal.",
                      " Hujung minggu — punch yang tiada adalah normal."
                    )
                  : ""}
              </p>
              {notIn.length > 0 && !isWeekend && (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                  ⚠ {L("Not clocked in:", "Belum daftar masuk:")}{" "}
                  {notIn.map((s) => firstName(s.name)).join(", ")}
                </p>
              )}
              {stillIn.length > 0 && afterShift && (
                <p className="mt-2 rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-900">
                  ⏳{" "}
                  {L(
                    "Past 18:00 with no clock-out yet:",
                    "Melepasi 18:00 tanpa daftar keluar lagi:"
                  )}{" "}
                  {stillIn.map((s) => firstName(s.name)).join(", ")}
                </p>
              )}
              {/* v1.4.196 (CEO): summary callouts stay; the full per-staff
                list hides behind one click — minimalist view */}
              <DetailsToggle label={L("Staff list", "Senarai kakitangan")}>
                <div className="border-border divide-border mt-1 max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {[...monitor.staff]
                    .sort(
                      (a, b) =>
                        Number(!!a.in_at) - Number(!!b.in_at) ||
                        a.name.localeCompare(b.name)
                    )
                    .map((st) => (
                      <div
                        key={st.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">
                            {properName(st.name)}
                          </span>
                          <span className="text-muted-foreground text-xs capitalize">
                            {" "}
                            · {st.role.replace(/_/g, " ")}
                            {st.employment_status === "part_time"
                              ? L(" (part-time)", " (separuh masa)")
                              : ""}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-1">
                          {st.in_at ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
                              {L("In", "Masuk")} {hm(st.in_at)}
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                              ⚠ {L("not clocked in", "belum daftar masuk")}
                            </span>
                          )}
                          {st.in_at &&
                            (st.out_at ? (
                              <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                                {L("Out", "Keluar")} {hm(st.out_at)}
                              </span>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${afterShift ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}
                              >
                                {afterShift
                                  ? L(
                                      "⏳ no clock-out",
                                      "⏳ tiada daftar keluar"
                                    )
                                  : L("still in", "belum keluar")}
                              </span>
                            ))}
                        </span>
                      </div>
                    ))}
                </div>
              </DetailsToggle>
            </div>
          );
        })()}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {reportMode && canReport
                ? L("Team attendance report", "Laporan kehadiran pasukan")
                : L("My attendance", "Kehadiran saya")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {reportMode && canReport
                ? L(
                    "Every punch across the team for the chosen month. Times are Malaysia time.",
                    "Setiap punch seluruh pasukan bagi bulan dipilih. Masa ialah waktu Malaysia."
                  )
                : L(
                    "Your days at work with hours counted — first clock-in to last clock-out. Times are Malaysia time.",
                    "Hari bekerja anda dengan jam dikira — daftar masuk pertama hingga daftar keluar terakhir. Masa ialah waktu Malaysia."
                  )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reportMode && canReport && records.length > 0 && (
              <select
                className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-44"
                value={filterName}
                title={L(
                  "Show one staff member only",
                  "Papar seorang kakitangan sahaja"
                )}
                onChange={(e) => setFilterName(e.target.value)}
              >
                <option value="">
                  {L("Find staff: everyone", "Cari kakitangan: semua")}
                </option>
                {[...new Set(records.map((r) => r.name).filter(Boolean))]
                  .sort()
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            )}

            <input
              type="month"
              className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {canReport && (
              <button
                type="button"
                className={btnGhost}
                onClick={() => setReportMode((v) => !v)}
              >
                {reportMode
                  ? L("My attendance", "Kehadiran saya")
                  : L("Team report", "Laporan pasukan")}
              </button>
            )}
          </div>
        </div>

        {records.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            {L("No records for this month.", "Tiada rekod untuk bulan ini.")}
          </p>
        )}

        {/* Personal view (v1.4.77): grouped by day — Date | In | Out | Hours. */}
        {!reportMode &&
          records.length > 0 &&
          (() => {
            const byDay = new Map<string, { ins: string[]; outs: string[] }>();
            for (const r of records) {
              const d = mytDateOf(r.created_at);
              const g = byDay.get(d) ?? { ins: [], outs: [] };
              (r.type === "clock_in" ? g.ins : g.outs).push(r.created_at);
              byDay.set(d, g);
            }
            const days = [...byDay.entries()].sort((a, b) =>
              b[0].localeCompare(a[0])
            );
            const hoursOf = (firstIn?: string, lastOut?: string) => {
              if (!firstIn || !lastOut) return null;
              const ms =
                new Date(lastOut.replace(" ", "T") + "Z").getTime() -
                new Date(firstIn.replace(" ", "T") + "Z").getTime();
              if (ms <= 0) return null;
              const h = Math.floor(ms / 3600000);
              const m = Math.round((ms % 3600000) / 60000);
              return `${h}h ${String(m).padStart(2, "0")}m`;
            };
            const totalMs = days.reduce((sum, [, g]) => {
              const fi = g.ins.sort()[0];
              const lo = g.outs.sort().at(-1);
              if (!fi || !lo) return sum;
              const ms =
                new Date(lo.replace(" ", "T") + "Z").getTime() -
                new Date(fi.replace(" ", "T") + "Z").getTime();
              return ms > 0 ? sum + ms : sum;
            }, 0);
            return (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-border border-b">
                      <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">
                        {L("Date", "Tarikh")}
                      </th>
                      <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">
                        {L("In", "Masuk")}
                      </th>
                      <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">
                        {L("Out", "Keluar")}
                      </th>
                      <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">
                        {L("Hours", "Jam")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(([d, g]) => {
                      const firstIn = g.ins.sort()[0];
                      const lastOut = g.outs.sort().at(-1);
                      const hrs = hoursOf(firstIn, lastOut);
                      return (
                        <tr
                          key={d}
                          className="border-border border-b last:border-0"
                        >
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                            {dmy(d)}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {firstIn ? (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                {mytTime(firstIn)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {lastOut ? (
                              <span className="bg-secondary rounded-full px-2 py-0.5 text-xs font-medium">
                                {mytTime(lastOut)}
                              </span>
                            ) : firstIn ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                {L("still in", "belum keluar")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {L("missing", "tiada")}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                            {hrs ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-border border-t-2 font-semibold">
                      <td className="px-2 py-2">
                        {L(
                          `${days.length} day${days.length === 1 ? "" : "s"}`,
                          `${days.length} hari`
                        )}
                      </td>
                      <td className="px-2 py-2" colSpan={2}></td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {totalMs > 0
                          ? `${Math.floor(totalMs / 3600000)}h ${String(Math.round((totalMs % 3600000) / 60000)).padStart(2, "0")}m`
                          : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}

        {/* Team report: every punch, sortable, with clear In/Out chips. */}
        {reportMode && canReport && records.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  {(
                    [
                      ["name", "Staff"],
                      ["type", "Type"],
                      ["time", "Time (MYT)"],
                    ] as const
                  ).map(([k, label]) => (
                    <th
                      key={k}
                      className="text-muted-foreground cursor-pointer px-2 py-2 text-left text-xs font-semibold uppercase select-none hover:underline"
                      title={L(
                        "Click to sort — click again to reverse",
                        "Klik untuk isih — klik lagi untuk terbalikkan"
                      )}
                      onClick={() => clickSort(k)}
                    >
                      {L(
                        label,
                        k === "name"
                          ? "Kakitangan"
                          : k === "type"
                            ? "Jenis"
                            : "Masa (MYT)"
                      )}
                      {sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const visible = filterName
                    ? records.filter((r) => r.name === filterName)
                    : records;
                  if (!sortKey) return visible;
                  const val = (r: (typeof records)[number]) =>
                    sortKey === "name"
                      ? (r.name ?? "")
                      : sortKey === "type"
                        ? r.type
                        : r.created_at;
                  return [...visible].sort(
                    (a, b) =>
                      (val(a).localeCompare(val(b)) ||
                        a.created_at.localeCompare(b.created_at)) * sortDir
                  );
                })().map((r, i) => (
                  <tr key={i} className="border-border border-b last:border-0">
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {r.name ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.type === "clock_in" ? "bg-green-100 text-green-800" : "bg-secondary"}`}
                      >
                        {r.type === "clock_in"
                          ? L("In", "Masuk")
                          : L("Out", "Keluar")}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {mytDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= Leave ================= */

const LEAVE_TYPES = [
  "annual",
  "medical",
  "emergency",
  "unpaid",
  "replacement",
] as const;

const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR review",
  hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO",
  pending_final: "Awaiting CEO",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
/* BM twin of STAGE_LABEL — display only, the stage value itself stays EN. */
const STAGE_LABEL_MS: Record<string, string> = {
  applied: "Menunggu semakan HR",
  hr_reviewed: "Menunggu pra-kelulusan",
  pre_approved: "Menunggu CEO",
  pending_final: "Menunggu CEO",
  approved: "Diluluskan",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};
const stageL = (s: string) =>
  (getLang() === "ms" ? STAGE_LABEL_MS[s] : STAGE_LABEL[s]) ?? s;

// Which stage a reviewer role can act on (mirrors the Worker's chain).
function canActOnStage(
  role: string,
  stage: string,
  applicantRole: string
): boolean {
  const HR = ["super_admin", "admin", "hr_admin"];
  const PRE = ["super_admin", "admin", "coo", "cco"];
  const FIN = ["super_admin", "admin", "ceo"];
  if (stage === "applied") return HR.includes(role);
  if (stage === "hr_reviewed")
    return applicantRole === "coo" || applicantRole === "cco"
      ? FIN.includes(role)
      : PRE.includes(role);
  if (stage === "pre_approved" || stage === "pending_final")
    return FIN.includes(role);
  return false;
}

/* v1.4.134: printable Leave Application Form — AZOO-HR-LVE-001, same flow
   and layout language as the claim form: employee e-signature + submission
   date, pre-approver name/signature/date, CEO full name + signature + date
   on approval, MYT everywhere, footer pinned to the A4 bottom, one page. */
/** v1.4.139: subhead label above placeholder fields (portal-wide pattern). */
function Sub({
  t,
  children,
  className = "",
}: {
  t: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
        {t}
      </span>
      {children}
    </label>
  );
}

/* v1.4.246: AZOO-HR-LVE-001 as a real PDF, handed to the phone's share sheet. */
async function sendLeavePdf(l: LeaveReq) {
  const dd = (l.created_at ?? "").slice(0, 10);
  const no = `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
  const blob = await buildLeavePdf(l, no);
  await sharePdfFile(blob, `${no}.pdf`, `Leave form ${no}`);
}

function printLeaveForm(l: LeaveReq, meName: string) {
  /* v1.28.0: the form names the EMPLOYER, so it forever carries the issuer
     stamped on the row — a legacy print stays AZ ONE OFFICIAL with its
     AZOO-HR-LVE document number; an A2Z form is a different controlled
     document with its own number and version (see lib/issuers.ts). */
  const issuer = resolveIssuer(l.issuer_code);
  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
  const myt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    if (iso.length <= 10) return dmy(iso);
    const d = new Date(
      new Date(
        iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")
      ).getTime() +
        8 * 3600 * 1000
    );
    if (Number.isNaN(d.getTime())) return dmy(iso);
    const i = d.toISOString();
    return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
  };
  const cA = l.created_at ?? "";
  const dd = cA.slice(0, 10);
  const lvNo = `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
  const stage = l.stage ?? l.status;
  const applicant = (l.user_full || l.user_name || meName || "").toUpperCase();
  const SIG_FILE: Record<string, string> = {
    ceo: "ceo-sign.png",
    coo: "coo-sign.png",
    cco: "cco-sign.png",
    hr_admin: "hr-admin-sign.png",
    sales_marketing: "sales-marketing-sign.png",
  };
  const empSig = SIG_FILE[l.applicant_role ?? ""] ?? null;
  const statusLine =
    stage === "approved"
      ? `APPROVED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.final_at ? " on " + myt(l.final_at) + " MYT" : ""}`
      : stage === "rejected"
        ? `REJECTED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.review_comment ? " · Note: " + l.review_comment : ""}`
        : stage === "cancelled"
          ? "CANCELLED BY APPLICANT"
          : `PENDING — ${stage === "applied" ? "awaiting HR review" : stage === "hr_reviewed" ? "HR ✓ — awaiting pre-approval" : "pre-approved — awaiting CEO"}`;
  const chainNotes = [
    l.hr_by_name
      ? `HR reviewed by ${l.hr_by_name}${l.hr_at ? " on " + myt(l.hr_at) + " MYT" : ""}`
      : "",
    l.preapp_by_name
      ? `Pre-approved by ${l.preapp_by_name}${l.preapp_at ? " on " + myt(l.preapp_at) + " MYT" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
  <title>${lvNo} — Leave Application Form</title>
  <style>
    @page { size: A4; margin: 0; } /* v1.4.239 — margin moved to @media print */
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 11.5px; margin: 0; padding: 10px; max-width: 210mm; margin-inline: auto;
           display: flex; flex-direction: column; min-height: 274mm; }
    h1 { text-align: center; margin: 2px 0 0; font-size: 18px; letter-spacing: .04em; }
    h1 small { display: block; font-size: 8px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    h2 { text-align: center; margin: 4px 0 9px; font-size: 13px; font-weight: 600; }
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; margin-bottom: 7px; }
    table { width: 100%; border-collapse: collapse; }
    .meta td { border: 1px solid #1a2946; padding: 4px 8px; }
    .meta .k { background: #f2f4f8; font-weight: 700; width: 18%; }
    .meta .v { width: 32%; }
    .status { margin: 10px 0 6px; font-weight: 700; color: ${stage === "approved" ? "#166534" : stage === "rejected" ? "#b00020" : "#1a2946"}; }
    .chain { margin: 0 0 8px; font-size: 10px; color: #555; }
    .sig th { border: 1px solid #1a2946; background: #f2f4f8; padding: 5px 8px; text-align: left; }
    .sig td.body { border: 1px solid #1a2946; padding: 6px 8px; height: 108px; vertical-align: top; }
    .cw { display: flex; flex-direction: column; height: 100%; }
    .nm { min-height: 26px; }
    .sg { height: 52px; }
    .dt { margin-top: auto; }
    .esig { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 15px; }
    .esub { display: block; font-size: 8px; color: #8a93a6; }
    .sigimg { height: 46px; max-width: 150px; object-fit: contain; object-position: left center; display: block; margin-top: 1px; }
    .foot { margin-top: auto; padding-top: 6px; font-size: 8px; color: #8a93a6; text-align: center; }
    @media print { body { padding: 9mm; min-height: 296mm; } } /* v1.4.239 */
  </style></head><body>
  <div class="goldbar"></div>
  <h1>${issuer.name}<small>LIVE · CONNECT · GROW</small></h1>
  <h2>Leave Application Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">${issuer.leaveFormNo}</td><td class="k">Version</td><td class="v">${issuer.leaveFormVersion}</td></tr>
    <tr><td class="k">Leave No.</td><td class="v">${lvNo}</td><td class="k">Date</td><td class="v">${myt(cA)}${cA.length > 10 ? " MYT" : ""}</td></tr>
    <tr><td class="k">Employee</td><td class="v">${applicant}</td><td class="k">Department</td><td class="v">${(l.user_department ?? "").toUpperCase()}</td></tr>
    <tr><td class="k">Position</td><td class="v">${(l.user_position ?? "").toUpperCase()}</td><td class="k">Leave type</td><td class="v" style="text-transform:uppercase">${l.type}</td></tr>
    <tr><td class="k">Period</td><td class="v">${dmy(l.start_date)} → ${dmy(l.end_date)}</td><td class="k">Days</td><td class="v">${l.days}</td></tr>
    <tr><td class="k">Reason</td><td class="v" colspan="3">${l.reason ?? ""}</td></tr>
  </table>
  <p class="status">System status: ${statusLine}</p>
  ${chainNotes ? `<p class="chain">${chainNotes}</p>` : ""}
  <table class="sig">
    <tr><th style="width:33%">Employee</th><th style="width:34%">Administrative or<br/>Head of Department (COO / CCO)</th><th style="width:33%">Chief Executive Officer (CEO)</th></tr>
    <tr>
      <td class="body"><div class="cw"><div class="nm">Name: ${applicant}</div>
        <div class="sg">Signature:${
          empSig
            ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/emp" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
            : ` <span class="esig">${l.user_full || l.user_name || meName || ""}</span><span class="esub">(submitted in system)</span>`
        }</div>
        <div class="dt">Date: ${myt(cA)}${cA.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${
        l.preapp_by_full || l.preapp_by_name
          ? `<div class="nm">Name: ${(l.preapp_by_full || l.preapp_by_name || "").toUpperCase()}</div>
           <div class="sg">Signature:<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/pre" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${l.preapp_at ? myt(l.preapp_at) + " MYT" : ""}</div>`
          : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`
      }</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${stage === "approved" ? (l.final_by_full || l.final_by_name || "").toUpperCase() : ""}</div>
        <div class="sg">Signature:${stage === "approved" ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/ceo" alt="" onerror="this.style.display='none'"/>` : ""}</div>
        <div class="dt">Date: ${stage === "approved" && l.final_at ? myt(l.final_at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  <p class="foot">${issuer.name} · ${issuer.registration} · ${issuer.address.replace(/, Malaysia$/, "")} · This form accompanies the system record ${lvNo}; the in-system decision is authoritative.</p>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`);
  w.document.close();
}

/* v1.4.249: the same number the printed form and the PDF carry, so a row, a
   printout and a shared file all name the record identically. */
function leaveNoOf(l: {
  created_at?: string | null;
  day_seq?: number | null;
  id: number;
}) {
  const dd = (l.created_at ?? "").slice(0, 10);
  return `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
}

function Leave({ user }: { user: User }) {
  const [openLeave, setOpenLeave] = useState<number | null>(null);
  const [balances, setBalances] = useState<
    Record<string, { entitled: number; used: number; accrued?: number }>
  >({});
  const [mine, setMine] = useState<LeaveReq[]>([]);
  const [all, setAll] = useState<LeaveReq[]>([]);
  const [draft, setDraft] = useState({
    type: "annual",
    start_date: "",
    end_date: "",
    days: 1,
    reason: "",
  });
  const canApprove = [
    "super_admin",
    "admin",
    "hr_admin",
    "coo",
    "cco",
    "ceo",
  ].includes(user.role);

  const load = useCallback(async () => {
    const b = await api<{ balances: typeof balances }>(`/staff/leave/balance`);
    setBalances(b.data?.balances ?? {});
    const m = await api<{ leave: LeaveReq[] }>(`/staff/leave`);
    setMine(m.data?.leave ?? []);
    if (canApprove) {
      /* v1.21.0 (CEO: "I still cant see any list applied… who is the person
         that apply leave and waiting for their Head approval"): keep the
         WHOLE list. The board below shows every in-progress application
         with whose approval it waits on; the action buttons appear only on
         rows this viewer can act on (the old filter hid everything else,
         so COO/CEO saw an empty board while requests sat at HR). */
      const a = await api<{ leave: LeaveReq[] }>(`/staff/leave?all=1`);
      setAll(a.data?.leave ?? []);
    }
  }, [canApprove, user.role, user.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const apply = async () => {
    if (!draft.start_date || !draft.end_date || draft.days <= 0) return;
    await api(`/staff/leave`, { method: "POST", body: JSON.stringify(draft) });
    setDraft({
      type: "annual",
      start_date: "",
      end_date: "",
      days: 1,
      reason: "",
    });
    void load();
  };
  const act = async (id: number, action: string, comment = "") => {
    await api(`/staff/leave/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action, comment }),
    });
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LEAVE_TYPES.map((t) => {
          const b = balances[t] ?? { entitled: 0, used: 0, accrued: 0 };
          // Eligible now = what has accrued this year minus what's been used.
          const availableNow = Math.max(0, (b.accrued ?? b.entitled) - b.used);
          return (
            <div key={t} className={card}>
              <p className="text-xs font-medium tracking-wide uppercase">
                {leaveTypeL(t)}
              </p>
              <p className="mt-1 text-lg font-semibold">
                {availableNow}
                <span className="text-muted-foreground text-xs font-normal">
                  {" "}
                  {L("eligible now", "layak sekarang")}
                </span>
              </p>
              <p className="text-muted-foreground text-[11px]">
                {L(
                  `${b.entitled}/year · ${b.used} used`,
                  `${b.entitled}/tahun · ${b.used} digunakan`
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">
            {L("Apply for leave", "Mohon cuti")}
          </p>
          <div className="mt-3 space-y-3">
            <Sub t={L("Leave type", "Jenis cuti")}>
              <select
                className={inputClass}
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value }))
                }
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {leaveTypeL(t)}
                  </option>
                ))}
              </select>
            </Sub>
            <div className="grid grid-cols-2 gap-3">
              <Sub t={L("Start date", "Tarikh mula")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.start_date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, start_date: e.target.value }))
                  }
                />
              </Sub>
              <Sub t={L("End date", "Tarikh tamat")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.end_date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, end_date: e.target.value }))
                  }
                />
              </Sub>
            </div>
            <Sub t={L("Days (0.5 = half day)", "Hari (0.5 = separuh hari)")}>
              <input
                type="number"
                min={0.5}
                step={0.5}
                className={inputClass}
                value={draft.days}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, days: Number(e.target.value) }))
                }
              />
            </Sub>
            <Sub t={L("Reason (optional)", "Sebab (pilihan)")}>
              <textarea
                className={inputClass}
                rows={2}
                placeholder={L(
                  "e.g. Family matters in Melaka",
                  "cth. Urusan keluarga di Melaka"
                )}
                value={draft.reason}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reason: e.target.value }))
                }
              />
            </Sub>
            <button
              type="button"
              className={btnClass}
              onClick={() => void apply()}
            >
              {L("Submit request", "Hantar permohonan")}
            </button>
          </div>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">
            {L("My leave history", "Sejarah cuti saya")}
          </p>
          {mine.length === 0 && (
            <p className="text-muted-foreground mt-2 text-sm">
              {L("No requests yet.", "Tiada permohonan lagi.")}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto">
            {mine.map((l) => (
              <div
                key={l.id}
                className="border-border border-b py-2 text-sm last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {/* v1.4.249: the leave number opens the record; type, period,
                    reason and the reviewer's comment moved into the panel. */}
                    <RecordToggle
                      open={openLeave === l.id}
                      title={L(
                        "Type, period, reason and comments",
                        "Jenis, tempoh, sebab dan komen"
                      )}
                      onToggle={() =>
                        setOpenLeave(openLeave === l.id ? null : l.id)
                      }
                    >
                      {leaveNoOf(l)}
                    </RecordToggle>
                    {" · "}
                    {l.days}d ·{" "}
                    <span className="font-medium">
                      {stageL((l as LeaveReq).stage ?? l.status)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "Print the Leave Application Form",
                        "Cetak Borang Permohonan Cuti"
                      )}
                      onClick={() => printLeaveForm(l, user.name)}
                    >
                      {L("Print form", "Cetak borang")}
                    </button>
                    {/* v1.4.246: the same form as a real PDF file, into the share sheet. */}
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "Send the leave form as a PDF file",
                        "Hantar borang cuti sebagai fail PDF"
                      )}
                      onClick={() => void sendLeavePdf(l)}
                    >
                      {L("Send PDF", "Hantar PDF")}
                    </button>
                    {!["approved", "rejected", "cancelled"].includes(
                      (l as LeaveReq).stage ?? ""
                    ) && (
                      <button
                        type="button"
                        className={rowBtnDanger}
                        onClick={() => void act(l.id, "cancel")}
                      >
                        {L("Cancel", "Batal")}
                      </button>
                    )}
                  </span>
                </div>
                {openLeave === l.id && (
                  <DetailGrid
                    items={[
                      { label: L("Type", "Jenis"), value: leaveTypeL(l.type) },
                      {
                        label: L("Period", "Tempoh"),
                        value: `${dmy(l.start_date)} → ${dmy(l.end_date)}`,
                      },
                      { label: L("Days", "Hari"), value: `${l.days}` },
                      {
                        label: L("Reason", "Sebab"),
                        wide: true,
                        value: l.reason ?? "",
                      },
                      {
                        label: L("Reviewer note", "Catatan penyemak"),
                        wide: true,
                        value: l.review_comment ?? "",
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {canApprove &&
        (() => {
          /* v1.21.0 — the whole approval chain sees the whole board. */
          const TERMINAL = ["approved", "rejected", "cancelled"];
          const pending = all.filter(
            (l) => !TERMINAL.includes(l.stage ?? l.status)
          );
          const decided = all
            .filter((l) => TERMINAL.includes(l.stage ?? l.status))
            .slice(0, 5);
          const waitingOn = (l: LeaveReq) => {
            const st = l.stage ?? "";
            if (st === "applied") return "HR";
            if (st === "hr_reviewed")
              return ["coo", "cco"].includes(l.applicant_role ?? "")
                ? "CEO"
                : "COO / CCO";
            return "CEO";
          };
          const who = (l: LeaveReq) =>
            properName(l.user_full || l.user_name || "");
          return (
            <div className={card}>
              <p className="text-sm font-semibold">
                {L(
                  "Leave applications — whole company",
                  "Permohonan cuti — seluruh syarikat"
                )}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L(
                  "Every application in progress, and whose approval it is waiting on. Action buttons appear on the ones waiting on you.",
                  "Setiap permohonan yang sedang diproses, dan kelulusan siapa yang ditunggu. Butang tindakan muncul pada yang menunggu anda."
                )}
              </p>
              {pending.length === 0 && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {L("Nothing in progress.", "Tiada yang sedang diproses.")}
                </p>
              )}
              <div className="max-h-80 overflow-y-auto">
                {pending.map((l) => {
                  const mine =
                    canActOnStage(
                      user.role,
                      l.stage ?? "",
                      l.applicant_role ?? ""
                    ) && l.user_id !== user.id;
                  return (
                    <div
                      key={l.id}
                      className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{who(l)}</span> ·{" "}
                        {leaveTypeL(l.type)} · {dmy(l.start_date)} →{" "}
                        {dmy(l.end_date)} ({l.days}d)
                        <span
                          className={`ml-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${mine ? "bg-warning-soft text-warning" : "bg-secondary text-muted-foreground"}`}
                        >
                          {L("waiting on", "menunggu")} {waitingOn(l)}
                        </span>
                      </span>
                      {mine && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void act(l.id, "approve")}
                          >
                            {l.stage === "applied"
                              ? L("Mark reviewed", "Tanda disemak")
                              : l.stage === "hr_reviewed"
                                ? L("Pre-approve", "Pra-lulus")
                                : L("Final approve", "Kelulusan akhir")}
                          </button>
                          <button
                            type="button"
                            className="text-destructive text-sm underline"
                            onClick={() => void act(l.id, "reject")}
                          >
                            {L("Reject", "Tolak")}
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {decided.length > 0 && (
                <div className="mt-3">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                    {L("Recently decided", "Keputusan terkini")}
                  </p>
                  {decided.map((l) => (
                    <p
                      key={l.id}
                      className="text-muted-foreground mt-1 text-xs"
                    >
                      {who(l)} · {leaveTypeL(l.type)} · {dmy(l.start_date)} →{" "}
                      {dmy(l.end_date)} · {stageL(l.stage ?? l.status)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}

/* ================= Tasks ================= */

function Tasks({ user }: { user: User }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    assigned_to: 0,
    priority: "normal",
    deadline: "",
  });
  const canManage = MANAGE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    const r = await api<{ tasks: Task[] }>(
      `/staff/tasks${canManage ? "?all=1" : ""}`
    );
    setTasks(r.data?.tasks ?? []);
    if (canManage) {
      /* v1.21.0 (CEO: "populate list of users instead of staff list data…
         staff name list should be populate full staff name"): the assignee
         picker read /staff/users — EVERY account, dupes, Super Admin and
         all. /staff-list is the one picker source: active staff only,
         full_name preferred. Used by Content/Sales already; now here too. */
      const u = await api<{ staff: { id: number; name: string }[] }>(
        `/staff/staff-list`
      );
      setTeam(u.data?.staff ?? []);
    }
  }, [canManage]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!draft.title) return;
    // Staff self-assign; managers may pick someone. 0 = self on the server.
    const payload = { ...draft, assigned_to: draft.assigned_to || undefined };
    await api(`/staff/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setDraft({
      title: "",
      description: "",
      assigned_to: 0,
      priority: "normal",
      deadline: "",
    });
    void load();
  };
  const update = async (id: number, patch: Record<string, unknown>) => {
    await api(`/staff/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    void load();
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
      <div className={card}>
        <p className="text-sm font-semibold">
          {canManage
            ? L("Create / assign a task", "Buat / agih tugasan")
            : L("Create a task", "Buat tugasan")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "You know your work best — add your own tasks with a deadline and track them as open, pending, or closed.",
            "Anda paling tahu kerja anda — tambah tugasan sendiri dengan tarikh akhir dan jejak sebagai terbuka, menunggu atau selesai."
          )}
        </p>
        <div className="mt-3 space-y-3">
          <Sub t={L("Title", "Tajuk")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. Prepare LIVE rundown",
                "cth. Sediakan rundown LIVE"
              )}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Description", "Keterangan")}>
            <textarea
              className={inputClass}
              rows={2}
              placeholder={L("What needs doing?", "Apa yang perlu dibuat?")}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Sub>
          {canManage && (
            <Sub t={L("Assign to", "Agihkan kepada")}>
              <select
                className={inputClass}
                value={draft.assigned_to}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assigned_to: Number(e.target.value),
                  }))
                }
              >
                <option value={0}>
                  {L("Assign to myself", "Agih kepada diri sendiri")}
                </option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Sub>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Sub t={L("Priority", "Keutamaan")}>
              <select
                className={inputClass}
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {priorityL(p)}
                  </option>
                ))}
              </select>
            </Sub>
            <Sub t={L("Deadline (optional)", "Tarikh akhir (pilihan)")}>
              <input
                type="date"
                className={inputClass}
                value={draft.deadline}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, deadline: e.target.value }))
                }
              />
            </Sub>
          </div>
          <button
            type="button"
            className={btnClass}
            onClick={() => void create()}
          >
            {L("Create task", "Buat tugasan")}
          </button>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">
          {canManage
            ? L("All tasks", "Semua tugasan")
            : L("My tasks", "Tugasan saya")}
        </p>
        {tasks.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No tasks.", "Tiada tugasan.")}
          </p>
        )}
        <div className="max-h-96 overflow-y-auto">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="border-border border-b py-2 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{t.title}</span>
                  {t.assignee ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {t.assignee}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    {" "}
                    · {priorityL(t.priority)}
                    {t.deadline
                      ? L(` · due ${t.deadline}`, ` · sebelum ${t.deadline}`)
                      : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <select
                    className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                    value={t.status}
                    onChange={(e) =>
                      void update(t.id, {
                        status: e.target.value,
                        progress:
                          e.target.value === "completed" ? 100 : t.progress,
                      })
                    }
                  >
                    {[
                      ["open", "Open"],
                      ["in_progress", "Pending"],
                      ["completed", "Closed"],
                    ].map(([v, lbl]) => (
                      <option key={v} value={v}>
                        {L(
                          lbl!,
                          v === "open"
                            ? "Terbuka"
                            : v === "in_progress"
                              ? "Menunggu"
                              : "Selesai"
                        )}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground text-xs">
                    {t.progress}%
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= Announcements ================= */

/* v1.4.215 (CEO pasted his real internal memo): Malay month names for the
   memo's default Tarikh line. */
const MS_MONTHS = [
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
];
const todayMalay = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCDate()} ${MS_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/* v1.4.215: renders an announcement body the way the CEO's memo reads —
   "Label: value" lines get a bold label, consecutive "* " lines become a
   real bullet list, everything else stays a paragraph. Plain bodies
   render exactly as before (they simply contain no label/bullet lines). */
function MemoBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) {
      out.push(
        <ul key={`ul${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[*•-]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flush();
    const label = ln.match(/^([A-Za-z][A-Za-z\s()\/&]{1,30}):\s+(.+)$/);
    if (label && !label[2]!.startsWith("//")) {
      out.push(
        <p key={i}>
          <span className="font-semibold">{label[1]}:</span> {label[2]}
        </p>
      );
    } else if (ln.trim() === "") {
      out.push(<div key={i} className="h-2" />);
    } else {
      out.push(<p key={i}>{ln}</p>);
    }
  });
  flush();
  return <div className="mt-2 text-sm">{out}</div>;
}

function Announcements({ user }: { user: User }) {
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState({ title: "", body: "", category: "news" });
  /* v1.4.223 (CEO: "placement textbox I want: Subject, To: From: and
     Body"): To/From on EVERY post — labels switch to Kepada/Daripada in
     memo mode, which also adds Tarikh + Perkara (v1.4.215). */
  const [toFrom, setToFrom] = useState({
    to: "All the staffs",
    from: "Management",
  }); // v1.4.224 defaults per CEO
  /* v1.4.262 (CEO: "subject and perkara is the same thing!"): they were.
     Perkara IS a memo's subject — the form asked for it twice and a careless
     publish could carry two different subjects on one memo. The Subject box
     is the single source; the memo header composes Perkara from it. */
  const [memo, setMemo] = useState({ tarikh: todayMalay() });
  const canPost = MANAGE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    const r = await api<{ announcements: Announcement[] }>(
      `/staff/announcements`
    );
    setAnns(r.data?.announcements ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    if (!draft.title || !draft.body) return;
    /* v1.4.215: a memo publishes with its header lines composed into the
       body — no schema change, and the feed renders them bold. */
    const isMemo = draft.category === "memo";
    const headerLines = [
      toFrom.to.trim() && `${isMemo ? "Kepada" : "To"}: ${toFrom.to.trim()}`,
      toFrom.from.trim() &&
        `${isMemo ? "Daripada" : "From"}: ${toFrom.from.trim()}`,
      isMemo && memo.tarikh.trim() && `Tarikh: ${memo.tarikh.trim()}`,
      isMemo && draft.title.trim() && `Perkara: ${draft.title.trim()}`,
    ].filter(Boolean);
    const body =
      headerLines.length > 0
        ? headerLines.join("\n") + "\n\n" + draft.body
        : draft.body;
    await api(`/staff/announcements`, {
      method: "POST",
      body: JSON.stringify({ ...draft, body }),
    });
    setDraft({ title: "", body: "", category: "news" });
    setToFrom({ to: "All the staffs", from: "Management" });
    setMemo({ tarikh: todayMalay() });
    void load();
  };
  const ack = async (id: number) => {
    await api(`/staff/announcements/${id}/ack`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {canPost && (
        <div className={card}>
          <p className="text-sm font-semibold">
            {L("Publish news", "Terbit berita")}
          </p>
          {/* v1.4.163 (CEO: "head section is not same as Dashboard"): this
              form predated the subhead standard — description + Sub labels
              added so it matches every other card. */}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Posted to every staff member — it appears on their Dashboard and in this feed until they press Acknowledge.",
              "Disiarkan kepada setiap kakitangan — ia muncul di Papan Pemuka mereka dan dalam suapan ini sehingga mereka menekan Perakui."
            )}
          </p>
          <div className="mt-3 space-y-3">
            {/* v1.4.224 (CEO): order = Category → Subject → To | From → Body. */}
            <Sub t={L("Category", "Kategori")}>
              <select
                className={`${inputClass} sm:max-w-44`}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {["news", "meeting", "holiday", "kpi", "training", "memo"].map(
                  (c) => (
                    <option key={c} value={c}>
                      {annCatL(c)}
                    </option>
                  )
                )}
              </select>
            </Sub>
            <Sub
              t={
                draft.category === "memo"
                  ? L("Subject / Perkara", "Perkara")
                  : L("Subject", "Perkara")
              }
            >
              <input
                className={inputClass}
                placeholder="e.g. Perubahan waktu balik bekerja"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
              />
            </Sub>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* v1.4.223: To/From placement boxes on EVERY post; memo mode
                  relabels to Kepada/Daripada and adds Tarikh + Perkara. */}
              <Sub
                t={
                  draft.category === "memo"
                    ? L("Kepada (To)", "Kepada")
                    : L("To", "Kepada")
                }
              >
                <input
                  className={inputClass}
                  value={toFrom.to}
                  onChange={(e) =>
                    setToFrom((m) => ({ ...m, to: e.target.value }))
                  }
                />
              </Sub>
              <Sub
                t={
                  draft.category === "memo"
                    ? L("Daripada (From)", "Daripada")
                    : L("From", "Daripada")
                }
              >
                <input
                  className={inputClass}
                  value={toFrom.from}
                  onChange={(e) =>
                    setToFrom((m) => ({ ...m, from: e.target.value }))
                  }
                />
              </Sub>
              {draft.category === "memo" && (
                <Sub t="Tarikh">
                  <input
                    className={inputClass}
                    value={memo.tarikh}
                    onChange={(e) =>
                      setMemo((m) => ({ ...m, tarikh: e.target.value }))
                    }
                  />
                </Sub>
              )}
            </div>
            <Sub
              t={
                draft.category === "memo"
                  ? "Kandungan memo"
                  : L("Body", "Kandungan")
              }
            >
              <textarea
                className={inputClass}
                rows={draft.category === "memo" ? 8 : 3}
                placeholder={
                  draft.category === "memo"
                    ? "Isi memo — guna * di awal baris untuk senarai bullet, dan 'Label: nilai' untuk baris tebal (cth. Masa: 9:00 pagi)"
                    : L("The full announcement text", "Teks penuh pengumuman")
                }
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
              />
            </Sub>
            <button
              type="button"
              className={btnClass}
              onClick={() => void post()}
            >
              {L("Publish", "Terbitkan")}
            </button>
          </div>
        </div>
      )}
      <div className="max-h-[28rem] space-y-6 overflow-y-auto pr-1">
        {anns.map((a) => (
          <article
            key={a.id}
            className={
              a.acked
                ? card
                : `${card} border-amber-400/70 bg-amber-50/40 dark:bg-amber-950/10`
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {!a.acked && (
                  <span className="mr-2 inline-flex -translate-y-px animate-pulse items-center rounded-full bg-amber-500 px-2 py-0.5 align-middle text-[10px] font-bold tracking-wide text-white uppercase">
                    {L("New", "Baru")}
                  </span>
                )}
                {a.title}{" "}
                <span className="text-muted-foreground font-normal">
                  · {annCatL(a.category)} · {dmy(a.created_at)}
                </span>
              </p>
              {a.acked ? (
                <span className="text-muted-foreground text-xs">
                  {L("Acknowledged ✓", "Diperakui ✓")}
                </span>
              ) : (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => void ack(a.id)}
                >
                  {L("Acknowledge", "Perakui")}
                </button>
              )}
            </div>
            <MemoBody body={a.body} />
          </article>
        ))}
      </div>
      {anns.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {L("No announcements yet.", "Tiada pengumuman lagi.")}
        </p>
      )}
    </div>
  );
}

/* ================= Sales (CRM + documents) ================= */

interface Customer {
  id: number;
  company: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address?: string | null;
  website?: string | null;
  logo_key?: string | null;
}
interface SalesDoc {
  id: number;
  doc_type: string;
  doc_number: string;
  company: string;
  total_cents: number;
  payment_status: string | null;
  delivery_status: string | null;
  created_at: string;
  converted_from?: number | null; // v1.4.233 — set when this INV came from a QT
  payment_ref?: string | null;
  paid_at?: string | null;
  salesperson_name?: string | null;
  customer_id?: number;
  customer_phone?: string | null;
  kind?: string | null; // v1.4.234
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
}

/* v1.28.0 — "MAYBANK · <HOLDER> · A/C <number>": the bank-transfer instruction
   the SOA and the WhatsApp invoice chase print, composed from the issuer so
   the payee named is always the entity whose account it is. Issuer.bank is
   "<BANK> <account number>" (lib/issuers.ts). */
function bankTransferLine(iss: Issuer): string {
  const [bankName, ...account] = iss.bank.split(" ");
  return `${bankName} · ${iss.bankHolder} · A/C ${account.join(" ")}`;
}

/** v1.4.101: printable Statement of Account per customer — same branded
    template family as the QT/DO/INV. Invoices only (paid + outstanding). */
/* v1.28.0: the SOA is not a re-print of a stored document — it is a fresh
   chase statement issued TODAY, so its letterhead, bank instruction and
   footer carry DOCUMENT_ISSUER (the current operator), even when the
   invoices it lists were issued by the earlier entity. */
function printSOA(company: string, docs: SalesDoc[]) {
  const invs = docs
    .filter((d) => d.doc_type === "INV" && d.company === company)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (invs.length === 0) return;
  const rm = fmtRM; // v1.4.272 global
  const total = invs.reduce((a, d) => a + d.total_cents, 0);
  const paid = invs
    .filter((d) => d.payment_status === "paid")
    .reduce((a, d) => a + d.total_cents, 0);
  const outstanding = total - paid;
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = invs
    .map(
      (d, i) => `<tr>
    <td class="c">${i + 1}</td><td>${d.doc_number}</td><td class="c">${dmy(d.created_at.slice(0, 10))}</td>
    <td class="c">${d.payment_status === "paid" ? `<span style="color:#15803d;font-weight:700">PAID${d.paid_at ? " " + dmy(d.paid_at.slice(0, 10)) : ""}</span>` : '<span style="color:#b45309;font-weight:700">OUTSTANDING</span>'}</td>
    <td class="r">${rm(d.total_cents)}</td>
    <td class="r">${d.payment_status === "paid" ? "—" : rm(d.total_cents)}</td>
  </tr>`
    )
    .join("");
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SOA — ${company}</title>
  <style>
    @page { size: A4; margin: 0; } * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; } /* v1.4.239 */
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 12px; margin: 0; padding: 12px; max-width: 210mm; margin-inline: auto; display: flex; flex-direction: column; min-height: 268mm; }
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; }
    .hd { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0 10px; border-bottom: 2.5px solid #1a2946; flex-wrap: wrap; }
    .brand { font-size: 19px; font-weight: 800; }
    .brand small { display: block; font-size: 8px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    .brand .addr { font-size: 9.5px; color: #5b6472; font-weight: 400; margin-top: 6px; line-height: 1.5; }
    .docbox { text-align: right; } .docbox h2 { margin: 0 0 4px; font-size: 19px; letter-spacing: .1em; }
    .party { margin-top: 12px; background: #f6f7fa; border-left: 3px solid #C9A227; border-radius: 6px; padding: 10px 12px; max-width: 340px; }
    .party .bt { margin: 0 0 4px; font-size: 9px; letter-spacing: .18em; color: #8a93a6; font-weight: 700; }
    .party .co { font-weight: 800; font-size: 13px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
    .items th { background: #1a2946; color: #fff; padding: 7px 9px; text-align: left; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
    .items th.c, .items td.c { text-align: center; } .items th.r, .items td.r { text-align: right; }
    .items td { padding: 7px 9px; border-bottom: 1px solid #e8ebf1; }
    .items tr:nth-child(even) td { background: #fafbfd; }
    .totwrap { display: flex; justify-content: flex-end; margin-top: 10px; }
    .tot { width: 300px; border-collapse: collapse; } .tot td { padding: 4px 10px; } .tot td:last-child { text-align: right; }
    .tot tr.grand td { background: #1a2946; color: #fff; font-weight: 800; padding: 8px 10px; }
    .pay { margin-top: auto; padding-top: 20px; font-size: 11px; }
    .foot { margin-top: 14px; font-size: 8.5px; color: #8a93a6; border-top: 1px solid #e8ebf1; padding-top: 8px; text-align: center; }
    @media print { body { padding: 14mm; min-height: 296mm; } } /* v1.4.239 */
  </style></head><body onload="window.print()">
  <div class="goldbar"></div>
  <div class="hd">
    <div class="brand">${DOCUMENT_ISSUER.name}<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small>
      <div class="addr">${DOCUMENT_ISSUER.descriptor} · ${DOCUMENT_ISSUER.registration}<br/>
      ${DOCUMENT_ISSUER.addressLines.join("<br/>")}<br/>
      ${DOCUMENT_ISSUER.email} · WhatsApp ${DOCUMENT_ISSUER.whatsapp}</div>
    </div>
    <div class="docbox"><h2>STATEMENT OF ACCOUNT</h2><div>As at ${dmy(today)}</div></div>
  </div>
  <div class="party"><p class="bt">ACCOUNT OF</p><p class="co">${company}</p></div>
  <table class="items">
    <thead><tr><th class="c" style="width:6%">#</th><th>Invoice No.</th><th class="c">Date</th><th class="c">Status</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totwrap"><table class="tot">
    <tr><td>Total invoiced</td><td>${rm(total)}</td></tr>
    <tr><td>Total paid</td><td>${rm(paid)}</td></tr>
    <tr class="grand"><td>BALANCE OUTSTANDING</td><td>${rm(outstanding)}</td></tr>
  </table></div>
  <div class="pay">Kindly settle the outstanding balance by bank transfer — ${bankTransferLine(DOCUMENT_ISSUER)}, quoting the invoice number. Please send the transfer receipt via WhatsApp ${DOCUMENT_ISSUER.whatsapp}.</div>
  <div class="foot">${DOCUMENT_ISSUER.name} · ${DOCUMENT_ISSUER.slogan} · ${DOCUMENT_ISSUER.website}<br/>This is a computer-generated statement; no signature is required.</div>
  </body></html>`);
  w.document.close();
}

/** Fetch a full document and open a branded, print-ready PDF window. */
/* v1.4.244: printDoc now only fetches and opens the window — the document
   itself is built by lib/doc-template so the customer's shared link renders
   the identical thing. */
async function printDoc(id: number) {
  const res = await fetch(`/api/v1/staff/docs/${id}`, {
    credentials: "include",
  });
  if (!res.ok) return;
  /* v1.33.3 — a 200 carrying no `doc` used to throw inside buildDocHtml, and
     this runs straight after a SUCCESSFUL save. The document exists; the
     person just sees the screen fall over instead of their PDF, assumes the
     save failed, and creates the invoice a second time. A duplicate invoice
     is a far worse outcome than a missing preview, so return quietly. */
  const { doc } = ((await res.json().catch(() => ({}))) ?? {}) as {
    doc?: DocFull;
  };
  if (!doc) return;
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(buildDocHtml(doc));
  w.document.close();
}

/* v1.4.181 (CEO: customers must be able to reach staff for package/service
   enquiries): the business team works those enquiries HERE, not only in
   /admin — newest first, category chips, status select, one-tap WhatsApp /
   email reply. */
/* v1.4.193 LIVE GMV (CEO: "staff view their live GMV daily results"): 🔥
   today + this month + last-7-days rows, all staff roles. Hosts with a live
   session scheduled today additionally see the GMV that landed during
   their session window(s) — motivation, not payroll. Auto-refresh 5 min. */
/* v1.4.197 LIVE ENGAGEMENT (CEO: "I want to bring this data into my
   dashboard too, possible?"): TikTok Shop LIVE analytics — views, likes,
   comments, shares, new followers etc. for the last 7 days, from the
   official /analytics shop_lives endpoint. Honest states: TikTok's own
   error verbatim while the Data & Insights (Analytics) scope is missing.
   LIVE Rewards (diamonds) is creator-side and NOT in the Shop API. */
/* v1.19.0 (consolidation C1): LiveGmvCard deleted — it showed the same
   TikTok month GMV as SalesRevenueCard's TikTok box on the SAME tab, from a
   second endpoint that could disagree on NULL-amount rows. One number, one
   card. (/staff/gmv itself survives: LiveEconomicsCard uses it.) */

/* v1.4.191 OT APPROVALS (CEO gap list): pending day-pairs decided here —
   only approved OT will ever feed payroll. */
function OtApprovalsCard({ inModal }: { inModal?: boolean } = {}) {
  interface Pend {
    user_id: number;
    name: string;
    d: string;
    ot_in: string | null;
    ot_out: string | null;
  }
  const [pending, setPending] = useState<Pend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const { confirm: otConfirm, node: otConfirmNode } = useConfirm();
  const load = async () => {
    const r = await api<{ pending?: Pend[] }>(`/staff/attendance/ot/pending`);
    if (r.ok) setPending(r.data?.pending ?? []);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);
  const decide = async (p: Pend, decision: "approved" | "rejected") => {
    if (
      decision === "rejected" &&
      !(await otConfirm({
        title: L("Reject this overtime?", "Tolak OT ini?"),
        message: L(
          `${properName(p.name)} — ${dmy(p.d)} ${p.ot_in ?? "?"}–${p.ot_out ?? "?"}. The staff member is notified either way.`,
          `${properName(p.name)} — ${dmy(p.d)} ${p.ot_in ?? "?"}–${p.ot_out ?? "?"}. Kakitangan akan dimaklumkan apa pun keputusannya.`
        ),
        confirmLabel: L("Reject OT", "Tolak OT"),
        variant: "danger",
      }))
    )
      return;
    await api(`/staff/attendance/ot/decide`, {
      method: "POST",
      body: JSON.stringify({
        user_id: p.user_id,
        date: p.d,
        decision,
        note: note[`${p.user_id}:${p.d}`] || undefined,
      }),
    });
    void load();
  };
  if (!loaded || pending.length === 0) return <>{otConfirmNode}</>;
  const dur = (p: Pend) => {
    if (!p.ot_in || !p.ot_out) return "";
    const [h1, m1] = p.ot_in.split(":").map(Number);
    const [h2, m2] = p.ot_out.split(":").map(Number);
    const mins = h2! * 60 + m2! - (h1! * 60 + m1!);
    return mins > 0
      ? ` · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`
      : "";
  };

  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : (
      <div className={card}>
        <p className="text-sm font-semibold">
          ⏱ {L("Overtime approvals", "Kelulusan OT")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Completed OT day-pairs awaiting a decision. Only APPROVED overtime will count when OT feeds payroll. The staff member is notified of every decision.",
            "Pasangan hari OT yang selesai dan menunggu keputusan. Hanya OT yang DILULUSKAN dikira apabila OT masuk ke gaji. Kakitangan dimaklumkan bagi setiap keputusan."
          )}
        </p>
        <div className="mt-3 space-y-0">{node}</div>
      </div>
    );

  return (
    <>
      {otConfirmNode}
      {wrapCard(
        <>
          {pending.map((p) => (
            <div
              key={`${p.user_id}:${p.d}`}
              className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 sm:px-5" : "py-2"}`}
            >
              <span className="min-w-0">
                <span className="font-medium">{properName(p.name)}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {dmy(p.d)} · {p.ot_in}–{p.ot_out}
                  {dur(p)}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  className="border-input bg-background w-36 rounded border px-1.5 py-0.5 text-xs"
                  placeholder={L("Note (optional)", "Catatan (pilihan)")}
                  value={note[`${p.user_id}:${p.d}`] ?? ""}
                  onChange={(e) =>
                    setNote((n) => ({
                      ...n,
                      [`${p.user_id}:${p.d}`]: e.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs font-medium"
                  onClick={() => void decide(p, "approved")}
                >
                  {L("Approve", "Luluskan")}
                </button>
                <button
                  type="button"
                  className="text-destructive border-border rounded border px-2 py-0.5 text-xs"
                  onClick={() => void decide(p, "rejected")}
                >
                  {L("Reject", "Tolak")}
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* v1.4.191 LIVE SESSION ROSTER (CEO gap list): which host, which client,
   which platform, what slot. Managers schedule; hosts see their own and are
   bell-notified on assignment. */
function LiveScheduleCard({
  user,
  inModal,
}: {
  user: User;
  inModal?: boolean;
}) {
  interface Sess {
    id: number;
    session_date: string;
    start_time: string;
    end_time?: string | null;
    platform: string;
    client_company?: string | null;
    client_name?: string | null;
    host_user_id: number;
    host_name: string;
    notes?: string | null;
    status: string;
  }
  interface Opt {
    id: number;
    name?: string | null;
    company?: string | null;
    role?: string;
  }
  const manager = [
    "ceo",
    "coo",
    "cco",
    "hr_admin",
    "super_admin",
    "admin",
  ].includes(user.role);
  /* v1.29.1 — same complaint as the roster board's Mark completed: this
     card's status dropdown changed a live session with no confirmation at
     all, and a rejected PATCH left the select showing the NEW value while
     the database still held the old one. It now reports through the shared
     save toast and reloads from the server either way. */
  const { show: showToast, node: toastNode } = useSaveToast();
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hosts, setHosts] = useState<Opt[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [draft, setDraft] = useState({
    session_date: "",
    start_time: "",
    end_time: "",
    platform: "tiktok",
    client_id: "",
    client_name: "",
    host_user_id: "",
    notes: "",
  });
  const load = async () => {
    const r = await api<{ sessions?: Sess[] }>(`/staff/live-sessions`);
    if (r.ok) setSessions(r.data?.sessions ?? []);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    if (manager) {
      /* v1.21.0: host picker moved to /staff-list — the one picker source
         (active staff, full names). It already excludes customer/admin
         accounts, so the old filter went with it. */
      void api<{ staff?: Opt[] }>(`/staff/staff-list`).then((r) => {
        if (r.ok) setHosts(r.data?.staff ?? []);
      });
      void api<{ customers?: Opt[] }>(`/staff/customers`).then((r) => {
        if (r.ok)
          setClients(
            (r.data?.customers ?? []).filter(
              (c) => (c.company ?? "") !== "Walk-in Customer"
            )
          );
      });
    }
  }, [manager]);
  const create = async () => {
    if (!draft.session_date || !draft.start_time || !draft.host_user_id) return;
    await api(`/staff/live-sessions`, {
      method: "POST",
      body: JSON.stringify({
        session_date: draft.session_date,
        start_time: draft.start_time,
        end_time: draft.end_time || undefined,
        platform: draft.platform,
        client_id: draft.client_id ? Number(draft.client_id) : undefined,
        client_name: draft.client_name || undefined,
        host_user_id: Number(draft.host_user_id),
        notes: draft.notes || undefined,
      }),
    });
    setDraft({
      session_date: "",
      start_time: "",
      end_time: "",
      platform: "tiktok",
      client_id: "",
      client_name: "",
      host_user_id: "",
      notes: "",
    });
    void load();
  };
  const setStatus = async (id: number, status: string) => {
    const sn = sessions.find((x) => x.id === id);
    const r = await api<{ error?: { message?: string } }>(
      `/staff/live-sessions/${id}`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    if (!r.ok) {
      showToast(
        L("No change", "Tiada perubahan"),
        r.data?.error?.message ??
          L("Could not update the session", "Sesi tidak dapat dikemas kini"),
        "notice"
      );
      void load(); // pull the real value back so the dropdown stops lying
      return;
    }
    showToast(
      status === "completed"
        ? L("Session completed", "Sesi selesai")
        : status === "cancelled"
          ? L("Session cancelled", "Sesi dibatalkan")
          : L("Back to scheduled", "Kembali kepada dijadualkan"),
      sn
        ? `${sn.client_company ?? sn.client_name ?? L("Live session", "Sesi LIVE")} · ${dmy(sn.session_date)} ${sn.start_time}`
        : ""
    );
    void load();
  };

  /* v1.21.2 (CEO: "lives today seem overfloating"): the modal variant had
     NO padding — fields and the empty-state line sat flush against the
     dialog edges. It now carries the dialog's standard inner padding. */
  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col px-4 pt-1 pb-4 sm:px-5 sm:pb-5">
        {node}
        {toastNode}
      </div>
    ) : (
      <div className={card}>
        <p className="text-sm font-semibold">
          📺 {L("Live session schedule", "Jadual sesi LIVE")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {manager
            ? L(
                "The roster: which host goes live for which client, on which platform, at what slot. Hosts are bell-notified when assigned.",
                "Roster: hos mana yang LIVE untuk pelanggan mana, di platform mana, pada slot apa. Hos dimaklumkan melalui loceng apabila ditugaskan."
              )
            : L(
                "Your upcoming live sessions — you are notified when a new one is assigned to you.",
                "Sesi LIVE anda yang akan datang — anda dimaklumkan apabila yang baharu ditugaskan kepada anda."
              )}
        </p>
        {node}
        {toastNode}
      </div>
    );

  if (!loaded) {
    return wrapCard(
      <div className="mt-2 animate-pulse space-y-3 px-4 sm:px-0">
        <div className="bg-secondary h-4 w-3/4 rounded"></div>
        <div className="bg-secondary h-4 w-1/2 rounded"></div>
        <div className="bg-secondary h-4 w-2/3 rounded"></div>
      </div>
    );
  }
  if (!manager && sessions.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No live sessions scheduled.", "Tiada sesi LIVE dijadualkan.")}
      </p>
    );
  }

  return wrapCard(
    <>
      {manager && (
        /* v1.21.2: inside the modal the form stays a tidy 2-up grid — the
           free-flowing sm:flex row was built for the full-width card and
           squeezed four fields into the dialog's 576px. */
        <div
          className={`mt-3 grid grid-cols-2 items-end gap-2 ${inModal ? "" : "sm:flex sm:flex-wrap"}`}
        >
          <Sub t={L("Date", "Tarikh")}>
            <input
              type="date"
              className={inputClass}
              value={draft.session_date}
              onChange={(e) =>
                setDraft((d) => ({ ...d, session_date: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Start", "Mula")}>
            <input
              type="time"
              className={inputClass}
              value={draft.start_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, start_time: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("End (optional)", "Tamat (pilihan)")}>
            <input
              type="time"
              className={inputClass}
              value={draft.end_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, end_time: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Platform", "Platform")}>
            <select
              className={inputClass}
              value={draft.platform}
              onChange={(e) =>
                setDraft((d) => ({ ...d, platform: e.target.value }))
              }
            >
              {["tiktok", "shopee", "other"].map((pf) => (
                <option key={pf} value={pf}>
                  {pf === "other" ? L("other", "lain-lain") : pf}
                </option>
              ))}
            </select>
          </Sub>
          <Sub t={L("Host", "Hos")}>
            <select
              className={inputClass}
              value={draft.host_user_id}
              onChange={(e) =>
                setDraft((d) => ({ ...d, host_user_id: e.target.value }))
              }
            >
              <option value="">{L("Select host…", "Pilih hos…")}</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {properName(h.name ?? "")}
                </option>
              ))}
            </select>
          </Sub>
          <Sub t={L("Client", "Pelanggan")}>
            <select
              className={inputClass}
              value={draft.client_id}
              onChange={(e) =>
                setDraft((d) => ({ ...d, client_id: e.target.value }))
              }
            >
              <option value="">
                {L(
                  "— unregistered / see note —",
                  "— tidak berdaftar / lihat catatan —"
                )}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </Sub>
          <Sub
            t={L("Notes (optional)", "Catatan (pilihan)")}
            className="col-span-2 sm:max-w-64 sm:flex-1"
          >
            <input
              className={inputClass}
              placeholder={L(
                "e.g. Raya campaign, product focus",
                "cth. Kempen Raya, fokus produk"
              )}
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
            />
          </Sub>
          <button
            type="button"
            className={`${btnClass} col-span-2 sm:col-span-1`}
            onClick={() => void create()}
          >
            {L("Schedule", "Jadualkan")}
          </button>
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {L("No sessions scheduled.", "Tiada sesi dijadualkan.")}
        </p>
      ) : (
        <div className="mt-3 max-h-96 space-y-0 overflow-y-auto pr-1">
          {sessions.map((sn) => (
            <div
              key={sn.id}
              className={`border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-2" : ""}`}
            >
              <span className="min-w-0">
                <span className="font-medium">{dmy(sn.session_date)}</span>{" "}
                <span className="text-muted-foreground">
                  {sn.start_time}
                  {sn.end_time ? `–${sn.end_time}` : ""}
                </span>{" "}
                <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                  {sn.platform}
                </span>{" "}
                <span>{properName(sn.host_name)}</span>
                {(sn.client_company ?? sn.client_name) && (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {sn.client_company ?? sn.client_name}
                  </span>
                )}
                {sn.notes && (
                  <span className="text-muted-foreground block text-xs">
                    {sn.notes}
                  </span>
                )}
              </span>
              {manager ? (
                <select
                  className="border-input bg-background rounded border px-1.5 py-0.5 text-[11px]"
                  value={sn.status}
                  onChange={(e) => void setStatus(sn.id, e.target.value)}
                >
                  {["scheduled", "completed", "cancelled"].map((st) => (
                    <option key={st} value={st}>
                      {sessStatusL(st)}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sn.status === "cancelled" ? "bg-red-100 text-red-900" : sn.status === "completed" ? "bg-secondary" : "bg-green-100 text-green-900"}`}
                >
                  {sessStatusL(sn.status)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* v1.4.191 CLIENT LAYER (CEO gap list): per-client agency view — invoiced /
   paid / quotations / live sessions per client, from the customers registry. */

/* v1.4.273 idea 6 — RM per live hour, per client and per host, this month.
   The one number a live agency should run on: which clients to upsell,
   which hosts are earning. Renders null until the worker route exists. */
function LiveEconomicsCard() {
  interface Econ {
    month: string;
    clients: {
      id: number;
      company: string;
      minutes: number;
      paid_cents: number;
    }[];
    hosts: { id: number; name: string; minutes: number; gmv_cents: number }[];
  }
  const [econ, setEcon] = useState<Econ | null>(null);
  useEffect(() => {
    void api<Econ>(`/staff/clients/live-economics`).then((r) => {
      if (r.ok && r.data) setEcon(r.data);
    });
  }, []);
  if (!econ || (econ.clients.length === 0 && econ.hosts.length === 0))
    return null;
  const hm = (mins: number) =>
    `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  const perHour = (cents: number, mins: number) =>
    mins > 0 ? fmtRM(Math.round((cents * 60) / mins)) : "—";
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        ⏱💰 {L("Live-hour economics", "Ekonomi jam LIVE")} — {ym(econ.month)}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "RM per hour of live this month. Clients: paid invoices ÷ completed session hours. Hosts: TikTok GMV landing during their sessions (motivation, not payroll).",
          "RM sejam LIVE bulan ini. Pelanggan: invois dibayar ÷ jam sesi selesai. Hos: GMV TikTok yang masuk semasa sesi mereka (motivasi, bukan gaji)."
        )}
      </p>
      {econ.clients.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("CLIENT", "PELANGGAN")}</th>
                <th className={thR2}>{L("HOURS", "JAM")}</th>
                <th className={thR2}>{L("PAID", "DIBAYAR")}</th>
                <th className={thR2}>{L("RM / HOUR", "RM / JAM")}</th>
              </tr>
            </thead>
            <tbody>
              {econ.clients.map((c) => (
                <tr key={c.id} className="border-border border-b last:border-0">
                  <td className={td}>{c.company}</td>
                  <td className={tdR2}>{hm(c.minutes)}</td>
                  <td className={tdR2}>{fmtRM(c.paid_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>
                    {perHour(c.paid_cents, c.minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {econ.hosts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="text-muted-foreground text-xs font-semibold">
            {L("Hosts", "Hos")}
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("HOST", "HOS")}</th>
                <th className={thR2}>{L("HOURS", "JAM")}</th>
                <th className={thR2}>{L("GMV IN-LIVE", "GMV SEMASA LIVE")}</th>
                <th className={thR2}>{L("RM / HOUR", "RM / JAM")}</th>
              </tr>
            </thead>
            <tbody>
              {econ.hosts.map((h) => (
                <tr key={h.id} className="border-border border-b last:border-0">
                  <td className={td}>{properName(h.name)}</td>
                  <td className={tdR2}>{hm(h.minutes)}</td>
                  <td className={tdR2}>{fmtRM(h.gmv_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>
                    {perHour(h.gmv_cents, h.minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* v1.4.273 idea 3 — the public package rate card, edited here, served on
   the public site at /packages. Prospects who see prices pre-qualify
   themselves. The public page stays a contact-us page until tiers exist
   (house rule: never display placeholder/zero content). CEO-only. */
function PackagesEditorCard({ role }: { role: string }) {
  interface Tier {
    name: string;
    price_label: string;
    points: string[];
  }
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  useEffect(() => {
    void api<{ packages: Tier[] | null }>(`/staff/sales/packages`).then((r) => {
      if (r.ok) setTiers(r.data?.packages ?? []);
      setLoaded(true);
    });
  }, []);
  if (!["ceo", "super_admin"].includes(role) || !loaded) return null;
  const upd = (i: number, patch: Partial<Tier>) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        📦 {L("Packages — public rate card", "Pakej — kadar harga awam")}
      </p>
      {toastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Shown on a2zcreative.my/packages with a WhatsApp button. The page stays a contact-us page until you save at least one tier here.",
          "Dipaparkan di a2zcreative.my/packages dengan butang WhatsApp. Halaman itu kekal sebagai halaman hubungi-kami sehingga anda menyimpan sekurang-kurangnya satu pakej di sini."
        )}
      </p>
      <div className="mt-2 space-y-3">
        {tiers.map((t, i) => (
          <div key={i} className="border-border rounded-lg border p-3">
            <div className={fieldRow}>
              <label className="text-sm">
                <span className="text-muted-foreground text-xs">
                  {L("Tier name", "Nama pakej")}
                </span>
                <input
                  className={inputClass}
                  placeholder={L("e.g. Starter", "cth. Starter")}
                  value={t.name}
                  onChange={(e) => upd(i, { name: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground text-xs">
                  {L("Price label", "Label harga")}
                </span>
                <input
                  className={inputClass}
                  placeholder={L(
                    "e.g. from RM 1,500/month",
                    "cth. dari RM 1,500/bulan"
                  )}
                  value={t.price_label}
                  onChange={(e) => upd(i, { price_label: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
              >
                {L("Remove tier", "Buang pakej")}
              </button>
            </div>
            <label className="mt-2 block text-sm">
              <span className="text-muted-foreground text-xs">
                {L(
                  "What's included — one point per line",
                  "Apa yang termasuk — satu poin setiap baris"
                )}
              </span>
              <textarea
                className={`${inputClass} min-h-20`}
                value={t.points.join("\n")}
                onChange={(e) => upd(i, { points: e.target.value.split("\n") })}
              />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {tiers.length < 6 && (
            <button
              type="button"
              className={btnClass}
              onClick={() =>
                setTiers((ts) => [
                  ...ts,
                  { name: "", price_label: "", points: [] },
                ])
              }
            >
              {L("+ Add tier", "+ Tambah pakej")}
            </button>
          )}
          <button
            type="button"
            className={btnClass}
            onClick={async () => {
              const clean = tiers
                .map((t) => ({
                  ...t,
                  points: t.points.map((p) => p.trim()).filter(Boolean),
                }))
                .filter((t) => t.name.trim());
              const r = await api(`/staff/sales/packages`, {
                method: "POST",
                body: JSON.stringify({ packages: clean }),
              });
              if (r.ok) {
                setTiers(clean);
                showToast(
                  L("Saved", "Disimpan"),
                  clean.length
                    ? L(
                        `${clean.length} tier${clean.length === 1 ? "" : "s"} live on /packages`,
                        `${clean.length} pakej disiarkan di /packages`
                      )
                    : L(
                        "Rate card cleared — the public page is back to contact-us",
                        "Kadar harga dikosongkan — halaman awam kembali kepada hubungi-kami"
                      )
                );
              } else
                showToast(
                  L("Not saved", "Tidak disimpan"),
                  (r.data as { error?: { message?: string } })?.error
                    ?.message ?? "Deploy the latest server first",
                  "notice"
                );
            }}
          >
            {L("Save rate card", "Simpan kadar harga")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* v1.4.281 — 🧩 Business lines ("my company do 2 business which is one for
   product sales and the other one is for service sales"): the two
   businesses reported separately — all-time share, then month by month.
   EXPANDABLE BY DESIGN: renders whatever lines the server sends; a third
   business line some day = zero changes here. Null until the worker has
   the route. */
function BusinessLinesCard() {
  interface RevLine {
    key: string;
    label: string;
    total_cents: number;
    months: { month: string; cents: number }[];
  }
  const [lines, setLines] = useState<RevLine[] | null>(null);
  useEffect(() => {
    void api<{ lines: RevLine[] }>(`/staff/revenue/lines`).then((r) => {
      if (r.ok && r.data) setLines(r.data.lines);
    });
  }, []);
  if (!lines || lines.length === 0) return null;
  const grand = lines.reduce((a, l) => a + l.total_cents, 0);
  if (grand === 0) return null;
  const monthSet = new Set<string>();
  for (const l of lines) for (const m of l.months) monthSet.add(m.month);
  const monthsDesc = [...monthSet].sort().reverse();
  const cellOf = (l: RevLine, m: string) =>
    l.months.find((x) => x.month === m)?.cents ?? 0;
  const TONE: Record<string, "navy" | "gold" | "muted"> = {
    product: "navy",
    service: "gold",
  };
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        🧩{" "}
        {L(
          "Business lines — product vs service",
          "Bidang perniagaan — produk vs perkhidmatan"
        )}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Your two businesses, reported separately. Product = TikTok, Shopee, walk-in and product invoices; service = paid service invoices. Same arithmetic as every other revenue figure.",
          "Dua perniagaan anda, dilaporkan berasingan. Produk = TikTok, Shopee, walk-in dan invois produk; perkhidmatan = invois perkhidmatan dibayar. Kiraan sama seperti setiap angka hasil yang lain."
        )}
      </p>
      <div className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0">{l.label.split(" (")[0]}</span>
            <div className="flex-1">
              <MiniBar
                pct={(l.total_cents / grand) * 100}
                tone={TONE[l.key] ?? "muted"}
              />
            </div>
            <span className="shrink-0 text-right font-medium tabular-nums">
              {fmtRM(l.total_cents)}
            </span>
            <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
              {Math.round((l.total_cents / grand) * 100)}%
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>{L("MONTH", "BULAN")}</th>
              {lines.map((l) => (
                <th key={l.key} className={thR2}>
                  {(l.label.split(" ")[0] || "").toUpperCase()}
                </th>
              ))}
              <th className={thR2}>{L("TOTAL", "JUMLAH")}</th>
            </tr>
          </thead>
          <tbody>
            {monthsDesc.map((m) => {
              const rowTotal = lines.reduce((a, l) => a + cellOf(l, m), 0);
              return (
                <tr key={m} className="border-border border-b last:border-0">
                  <td className={td}>{ym(m)}</td>
                  {lines.map((l) => {
                    const c = cellOf(l, m);
                    return (
                      <td key={l.key} className={tdR2}>
                        {c ? fmtRM(c) : "—"}
                      </td>
                    );
                  })}
                  <td className={`${tdR2} font-medium`}>{fmtRM(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={th}>{L("TOTAL", "JUMLAH")}</th>
              {lines.map((l) => (
                <th key={l.key} className={thR2}>
                  {fmtRM(l.total_cents)}
                </th>
              ))}
              <th className={thR2}>{fmtRM(grand)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* v1.4.278 — 📊 Sales history ("powerful system for my sales track"):
   every month of the business, all four channels (the /revenue overall
   block), with month-over-month movement and each month measured against
   the best. Frontend-only — the arithmetic already lives server-side. */
function SalesHistoryCard() {
  const [rev, setRev] = useState<RevenueData | null>(null);
  useEffect(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => {
      if (r.ok && r.data) setRev(r.data);
    });
  }, []);
  const months = rev?.overall?.months ?? [];
  if (months.length === 0) return null;
  const best = Math.max(...months.map((m) => m.cents), 1);
  const total = months.reduce((a, m) => a + m.cents, 0);
  const rows = [...months].reverse(); // newest first
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        📊{" "}
        {L(
          "Sales history — month by month",
          "Sejarah jualan — bulan demi bulan"
        )}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "All four channels, since day one. The bar measures each month against your best.",
          "Kesemua empat saluran, sejak hari pertama. Bar mengukur setiap bulan berbanding bulan terbaik anda."
        )}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>{L("MONTH", "BULAN")}</th>
              <th className={thR2}>{L("SALES", "JUALAN")}</th>
              <th className={thR2}>{L("VS PREV", "VS SEBELUM")}</th>
              <th className={`${th} w-28`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const prev = rows[i + 1]; // list is newest-first
              const delta =
                prev && prev.cents > 0
                  ? ((m.cents - prev.cents) / prev.cents) * 100
                  : null;
              return (
                <tr
                  key={m.month}
                  className="border-border border-b last:border-0"
                >
                  <td className={td}>
                    {ym(m.month)}
                    {m.cents >= best - 0.5 ? " 🏆" : ""}
                  </td>
                  <td className={tdR2}>{fmtRM(m.cents)}</td>
                  <td
                    className={`${tdR2} ${delta == null ? "text-muted-foreground" : delta >= 0 ? "text-green-700" : "text-red-600"}`}
                  >
                    {delta == null
                      ? "—"
                      : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`}
                  </td>
                  <td className={td}>
                    <MiniBar
                      pct={(m.cents / best) * 100}
                      tone={m.cents >= best - 0.5 ? "green" : "gold"}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={th}>{L("TOTAL", "JUMLAH")}</th>
              <th className={thR2}>{fmtRM(total)}</th>
              <th className={thR2}></th>
              <th className={th}></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* v1.4.278 — 💹 Profit & loss by month ("…and also expenses"): revenue −
   expenses − payroll − approved claims = the number the business actually
   keeps. Renders null on a worker that predates the route. */
function PnlCard({ inModal }: { inModal?: boolean } = {}) {
  interface PnlMonth {
    month: string;
    revenue_cents: number;
    expenses_cents: number;
    payroll_cents: number;
    claims_cents: number;
    net_cents: number;
  }
  const [months, setMonths] = useState<PnlMonth[] | null>(null);
  useEffect(() => {
    void api<{ months: PnlMonth[] }>(`/staff/finance/pnl`).then((r) => {
      if (r.ok && r.data) setMonths(r.data.months);
    });
  }, []);
  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex w-full flex-col overflow-x-auto pb-4 sm:pb-0">
        {node}
      </div>
    ) : (
      <div className={card}>
        <p className="text-sm font-semibold">
          💹{" "}
          {L(
            "Profit & loss — month by month",
            "Untung & rugi — bulan demi bulan"
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Revenue (all channels) minus expenses, payroll and approved claims — what the business keeps. Payroll uses the same net figures as the M2E salary file.",
            "Hasil (semua saluran) tolak perbelanjaan, gaji dan tuntutan diluluskan — apa yang perniagaan simpan. Gaji menggunakan angka bersih yang sama seperti fail gaji M2E."
          )}
        </p>
        <div className="mt-2 overflow-x-auto">{node}</div>
      </div>
    );

  if (!months) {
    return wrapCard(
      <div className="mt-2 animate-pulse space-y-3 px-4 sm:px-0">
        <div className="bg-secondary h-4 w-full rounded"></div>
        <div className="bg-secondary h-4 w-full rounded"></div>
      </div>
    );
  }
  if (months.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No financial data available yet.", "Tiada data kewangan lagi.")}
      </p>
    );
  }
  const rows = [...months].reverse(); // newest first

  return wrapCard(
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-border border-b">
          <th className={th}>{L("MONTH", "BULAN")}</th>
          <th className={thR2}>{L("REVENUE", "HASIL")}</th>
          <th className={thR2}>{L("EXPENSES", "PERBELANJAAN")}</th>
          <th className={thR2}>{L("PAYROLL", "GAJI")}</th>
          <th className={thR2}>{L("CLAIMS", "TUNTUTAN")}</th>
          <th className={thR2}>{L("NET", "BERSIH")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.month} className="border-border border-b last:border-0">
            <td className={td}>{ym(m.month)}</td>
            <td className={tdR2}>{fmtRM(m.revenue_cents)}</td>
            <td className={tdR2}>
              {m.expenses_cents ? fmtRM(m.expenses_cents) : "—"}
            </td>
            <td className={tdR2}>
              {m.payroll_cents ? fmtRM(m.payroll_cents) : "—"}
            </td>
            <td className={tdR2}>
              {m.claims_cents ? fmtRM(m.claims_cents) : "—"}
            </td>
            <td
              className={`${tdR2} font-semibold ${m.net_cents >= 0 ? "text-green-700" : "text-red-600"}`}
            >
              {fmtRM(m.net_cents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* v1.5.0: PipelineInsightsCard removed with the Social tab. */

function ClientsCard({ inModal }: { inModal?: boolean } = {}) {
  interface Cl {
    id: number;
    company: string;
    name?: string | null;
    invoices: number;
    invoiced_cents: number;
    paid_cents: number;
    quotations: number;
  }
  const [clients, setClients] = useState<Cl[]>([]);
  const [sessions, setSessions] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const { show: showRlToast, node: rlToastNode } = useSaveToast();
  useEffect(() => {
    void api<{ clients?: Cl[]; sessions?: Record<string, number> }>(
      `/staff/clients/summary`
    ).then((r) => {
      if (r.ok) {
        setClients(r.data?.clients ?? []);
        setSessions(r.data?.sessions ?? {});
      }
      setLoaded(true);
    });
  }, []);

  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : (
      <div className={card}>
        <p className="text-sm font-semibold">💎 {L("Clients", "Pelanggan")}</p>
        <div className="mt-3">{node}</div>
      </div>
    );

  if (!loaded) {
    return wrapCard(
      <div className="mt-2 animate-pulse space-y-3 px-4 sm:px-0">
        <div className="bg-secondary h-4 w-3/4 rounded"></div>
        <div className="bg-secondary h-4 w-1/2 rounded"></div>
        <div className="bg-secondary h-4 w-2/3 rounded"></div>
      </div>
    );
  }
  if (clients.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No active clients.", "Tiada pelanggan aktif.")}
      </p>
    );
  }
  const rm2 = fmtRM; // v1.4.272 global (this one even lacked thousand separators)
  return wrapCard(
    <>
      {rlToastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Per-client view from your sales documents and the live roster — invoiced, collected, quotations in play and sessions scheduled.",
          "Paparan setiap pelanggan daripada dokumen jualan anda dan roster LIVE — diinvois, dikutip, sebut harga aktif dan sesi dijadualkan."
        )}
      </p>
      <div
        className={
          inModal ? "overflow-y-auto" : "mt-3 max-h-80 overflow-y-auto pr-1"
        }
      >
        {clients.map((c) => (
          <div
            key={c.id}
            className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "py-2"}`}
          >
            <span className="min-w-0 font-medium">{c.company}</span>
            <span className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-2 text-xs">
              <span
                title={L(
                  "Invoiced total (all INV)",
                  "Jumlah diinvois (semua INV)"
                )}
              >
                {rm2(c.invoiced_cents)} {L("invoiced", "diinvois")}
              </span>
              <span
                className="font-medium text-green-700"
                title={L(
                  "Collected (paid invoices)",
                  "Dikutip (invois dibayar)"
                )}
              >
                {rm2(c.paid_cents)} {L("paid", "dibayar")}
              </span>
              <span title={L("Quotations issued", "Sebut harga dikeluarkan")}>
                {c.quotations} QT
              </span>
              <span
                title={L(
                  "Live sessions scheduled (not cancelled)",
                  "Sesi LIVE dijadualkan (tidak dibatalkan)"
                )}
              >
                {sessions[String(c.id)] ?? 0} live
              </span>
              {/* v1.4.273 idea 1: the client report link — a public monthly
                  performance page they can forward to their boss. Retention
                  weapon + our best brochure. */}
              <button
                type="button"
                className="underline"
                title={L(
                  "Copy this client's monthly report link",
                  "Salin pautan laporan bulanan pelanggan ini"
                )}
                onClick={async () => {
                  const r = await api<{ token?: string }>(
                    `/staff/clients/${c.id}/report-link`,
                    { method: "POST" }
                  );
                  if (!r.ok || !r.data?.token) {
                    showRlToast(
                      L("Not available", "Tidak tersedia"),
                      (r.data as { error?: { message?: string } })?.error
                        ?.message ??
                        "Deploy the latest server + run migration 0067 first",
                      "notice"
                    );
                    return;
                  }
                  const url = `${location.origin}/report?t=${r.data.token}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    showRlToast(
                      L("Report link copied", "Pautan laporan disalin"),
                      L(
                        `${c.company} — paste it into WhatsApp`,
                        `${c.company} — tampal ke WhatsApp`
                      )
                    );
                  } catch {
                    showRlToast(
                      L("Report link", "Pautan laporan"),
                      url,
                      "notice"
                    );
                  }
                }}
              >
                🔗 {L("Report link", "Pautan laporan")}
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function CustomerEnquiriesCard() {
  interface Enq {
    id: number;
    name: string;
    company?: string | null;
    phone?: string | null;
    email: string;
    message: string;
    category?: string | null;
    status: string;
    reply?: string | null;
    replied_at?: string | null;
    created_at: string;
  }
  const [enqs, setEnqs] = useState<Enq[]>([]);
  const [loaded, setLoaded] = useState(false);
  const CAT: Record<string, string> = {
    general: L("General", "Umum"),
    package_pricing: L("Package & pricing", "Pakej & harga"),
    live_commerce: L("Live commerce", "Jualan LIVE"),
    order_delivery: L("Order & delivery", "Pesanan & penghantaran"),
    collaboration: L("Collaboration", "Kerjasama"),
  };
  const load = async () => {
    try {
      const r = await fetch("/api/v1/enquiries", { credentials: "include" });
      if (r.ok) {
        const d = (await r.json()) as { enquiries?: Enq[] };
        setEnqs(d.enquiries ?? []);
      }
    } catch {
      /* card stays empty */
    }
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);
  const setStatus = async (id: number, status: string) => {
    await csrfFetch(`/api/v1/enquiries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    void load();
  };
  /* v1.21.0: the "convert to lead" hop went with the retired Pipeline tab —
     an enquiry that becomes business is marked qualified here and raised as
     a quotation in the Sales panel directly below this card. */
  // v1.4.191: in-app reply — the customer reads it on /account.
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const [replyOpen, setReplyOpen] = useState<number | null>(null);
  const sendReply = async (id: number) => {
    const text = (replyDraft[id] ?? "").trim();
    if (!text) return;
    await csrfFetch(`/api/v1/enquiries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: text }),
    });
    setReplyOpen(null);
    setReplyDraft((d) => ({ ...d, [id]: "" }));
    void load();
  };
  if (!loaded) return null;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        {L("Customer enquiries", "Pertanyaan pelanggan")}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Questions from /account customers — you are bell-notified when one lands. Answer directly on WhatsApp or email, then set the status.",
          "Soalan daripada pelanggan /account — anda dimaklumkan melalui loceng apabila satu diterima. Jawab terus melalui WhatsApp atau e-mel, kemudian tetapkan status."
        )}
      </p>
      {enqs.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {L("No enquiries yet.", "Tiada pertanyaan lagi.")}
        </p>
      ) : (
        <div className="mt-3 max-h-96 space-y-0 overflow-y-auto pr-1">
          {enqs.map((e) => (
            <div
              key={e.id}
              className="border-border border-b py-2 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{e.name}</span>
                  {e.company ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {e.company}
                    </span>
                  ) : null}
                  {e.category ? (
                    <span className="bg-secondary ml-1.5 rounded-full px-2 py-0.5 text-[10px]">
                      {CAT[e.category] ?? e.category}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
                  {e.phone && (
                    <a
                      className="underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`https://wa.me/${e.phone.replace(/[^0-9]/g, "")}`}
                    >
                      WhatsApp
                    </a>
                  )}
                  <a className="underline" href={`mailto:${e.email}`}>
                    {L("Email", "E-mel")}
                  </a>
                  <select
                    className="border-input bg-background rounded border px-1.5 py-0.5 text-[11px]"
                    value={e.status}
                    onChange={(ev) => void setStatus(e.id, ev.target.value)}
                  >
                    {["new", "contacted", "qualified", "closed"].map((st) => (
                      <option key={st} value={st}>
                        {enqStatusL(st)}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">{e.message}</p>
              {e.reply && (
                <p className="mt-1 rounded border border-green-300 bg-green-100 px-2 py-1 text-xs text-green-900">
                  {L("Replied", "Dibalas")}
                  {e.replied_at
                    ? ` ${mytDateTime(e.replied_at)} MYT`
                    : ""}: {e.reply}
                </p>
              )}
              {replyOpen === e.id ? (
                <span className="mt-1 flex items-center gap-1.5">
                  <input
                    className="border-input bg-background min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                    placeholder={L(
                      "Write the reply the customer will see on /account…",
                      "Tulis balasan yang akan dilihat pelanggan di /account…"
                    )}
                    value={replyDraft[e.id] ?? ""}
                    onChange={(ev) =>
                      setReplyDraft((d) => ({ ...d, [e.id]: ev.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs font-medium"
                    onClick={() => void sendReply(e.id)}
                  >
                    {L("Send", "Hantar")}
                  </button>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => setReplyOpen(null)}
                  >
                    {L("Cancel", "Batal")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="mt-1 text-xs underline"
                  onClick={() => setReplyOpen(e.id)}
                >
                  {e.reply
                    ? L("Update reply", "Kemas kini balasan")
                    : L("Reply in-app", "Balas dalam aplikasi")}
                </button>
              )}
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {e.email} · {mytDateTime(e.created_at)} MYT
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* v1.4.263: word the inventory movement an invoice caused, for the toast.
   Silence would repeat the In+ mistake (v1.4.251) — stock moving with no
   confirmation — and a wrong-SKU line NOT deducting must be said loudest. */
function stockToastLine(
  s:
    | {
        deducted: { sku: string; qty: number; stock: number }[];
        unmatched: string[];
        short: string[];
      }
    | null
    | undefined
): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.deducted.length)
    parts.push(
      L(
        `stock deducted: ${s.deducted.map((d) => `${d.sku} −${d.qty} (now ${d.stock})`).join(", ")}`,
        `stok ditolak: ${s.deducted.map((d) => `${d.sku} −${d.qty} (kini ${d.stock})`).join(", ")}`
      )
    );
  if (s.unmatched.length)
    parts.push(
      L(
        `⚠ NOT in inventory, not deducted: ${s.unmatched.join(", ")}`,
        `⚠ TIADA dalam inventori, tidak ditolak: ${s.unmatched.join(", ")}`
      )
    );
  if (s.short.length)
    parts.push(
      L(`⚠ short: ${s.short.join("; ")}`, `⚠ kurang: ${s.short.join("; ")}`)
    );
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

function Sales({ user }: { user: User }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [cust, setCust] = useState({
    company: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    website: "",
  });
  /* v1.30.0 — the client's own mark. Uploading needs the row to exist (the
     object key is built from its id), so the button only appears while
     editing a saved customer. */
  const [logoBusy, setLogoBusy] = useState<number | null>(null);
  const [editingCust, setEditingCust] = useState<{
    id: number;
    company: string;
  } | null>(null); // v1.4.235
  // customer_id: -1 = not chosen · 0 = walk-in/unidentified buyer.
  // salesperson_id: 0 = "me" (worker defaults to the creator).
  const [doc, setDoc] = useState<{
    doc_type: string;
    customer_id: number;
    salesperson_id: number;
    kind: string;
    items: DocItem[];
    discount_cents: number;
    tax_percent: number;
    delivery_cents: number;
    paid_received: boolean;
    reference: string;
    delivery_address: string;
    /* v1.30.1 — which entity issues this document: "a2z" (default) or
       "azoo" (AZ ONE OFFICIAL, consultancy work). Set at creation only;
       the worker ignores it on edit. */
    issuer: string;
  }>({
    doc_type: "QT",
    customer_id: -1,
    salesperson_id: 0,
    kind: "product",
    items: [{ name: "", qty: 1, unit_price_cents: 0 }],
    discount_cents: 0,
    tax_percent: 0,
    delivery_cents: 0,
    paid_received: false,
    reference: "",
    delivery_address: "",
    issuer: "a2z",
  });
  const [staffList, setStaffList] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const { show: showToast, node: toastNode } = useSaveToast();

  /* v1.4.273 idea 2: the prospect → quotation handoff. The Social tab wrote
     a prefill into localStorage and jumped here; we either pick the existing
     customer by company name or pre-fill the new-customer form, and stamp
     the reference so the QT says where it came from. */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem("azone-qt-prefill");
    } catch {
      return;
    }
    if (!raw) return;
    try {
      localStorage.removeItem("azone-qt-prefill");
    } catch {
      /* fine */
    }
    try {
      const pf = JSON.parse(raw) as {
        company?: string;
        contact_person?: string;
        phone?: string;
        reference?: string;
      };
      const existing = customers.find(
        (c) =>
          c.company.trim().toLowerCase() ===
          (pf.company ?? "").trim().toLowerCase()
      );
      setDoc((d) => ({
        ...d,
        doc_type: "QT",
        reference: pf.reference ?? d.reference,
        customer_id: existing ? existing.id : d.customer_id,
      }));
      if (!existing)
        setCust((c) => ({
          ...c,
          company: pf.company ?? "",
          contact_person: pf.contact_person ?? "",
          phone: pf.phone ?? "",
        }));
      showToast(
        L("Prefilled from prospect", "Diisi awal daripada prospek"),
        existing
          ? L(
              `${existing.company} selected — add the package lines and save the quotation`,
              `${existing.company} dipilih — tambah baris pakej dan simpan sebut harga`
            )
          : L(
              `Add ${pf.company ?? "the client"} as a customer first, then the quotation form is ready`,
              `Tambah ${pf.company ?? "pelanggan itu"} sebagai pelanggan dahulu, kemudian borang sebut harga sedia`
            )
      );
    } catch {
      /* malformed handoff — ignore */
    }
    // customers in deps: on a cold open the list arrives after mount and the
    // company match must run against the LOADED list.
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  /* v1.4.240 (CEO: "why the popup card was not standardize like the current
     use"): the Sales tab was the last place still raising the browser's own
     "azoneofficial.com says" box — every destructive action here now uses the
     branded useConfirm() dialog, same family as the toasts. */
  const { confirm: askConfirm, node: confirmNode } = useConfirm();
  /* v1.4.248: the v1.4.240 sweep replaced every window.confirm but left the
     payment-reference prompt standing — the last native browser panel
     in the portal. */
  const { prompt: askText, node: promptNode } = usePrompt();
  /* v1.4.248 minimalist rows (CEO: "click at the document number can appear
     the details. the button remain at outside"): one document open at a time
     — opening another closes the first, so the list never grows tall. */
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const [openCust, setOpenCust] = useState<number | null>(null);
  // v1.4.94: backdating + typo edits. editingDoc = the document being fixed
  // (its number never changes); doc_date/paid_date allow true past dates for
  // payments received before this system existed.
  const [docDate, setDocDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [editingDoc, setEditingDoc] = useState<{
    id: number;
    doc_number: string;
  } | null>(null);
  const [invItems, setInvItems] = useState<
    { name: string; sku: string; unit_price_cents?: number }[]
  >([]);
  // v1.4.96: aligned with the worker's finance permission — sales_marketing
  // creates QT/DO; invoices are created by finance roles ON THEIR BEHALF via
  // the Sales person dropdown (that's the attribution mechanism).
  const canInvoice = [
    "super_admin",
    "admin",
    "hr_admin",
    "coo",
    "cco",
    "ceo",
    "sales_marketing",
  ].includes(user.role);

  const load = useCallback(async () => {
    const c = await api<{ customers: Customer[] }>(`/staff/customers`);
    setCustomers(c.data?.customers ?? []);
    const d = await api<{ docs: SalesDoc[]; error?: { message?: string } }>(
      `/staff/docs`
    );
    setDocs(d.data?.docs ?? []);
    setDocsError(
      d.ok
        ? null
        : (d.data?.error?.message ??
            L(
              "Could not load documents — press Refresh to retry",
              "Tidak dapat memuatkan dokumen — tekan Muat semula untuk cuba lagi"
            ))
    );
    const sl = await api<{
      staff: { id: number; name: string; role: string }[];
    }>(`/staff/staff-list`);
    setStaffList(sl.data?.staff ?? []);
    // v1.4.101: item descriptions suggest from Inventory (manual entry still fine).
    const inv = await api<{
      items?: { name: string; sku: string; unit_price_cents?: number }[];
    }>(`/staff/inventory`);
    setInvItems(inv.data?.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const addCustomer = async () => {
    if (!cust.company) return;
    /* v1.4.235 (CEO: "existing data I can edit and update or delete"):
       the same form saves a new customer OR updates the one being edited
       (PUT sends every field; empty boxes clear the stored value). */
    if (editingCust) {
      const res = await api<{ error?: { message?: string } }>(
        `/staff/customers/${editingCust.id}`,
        { method: "PUT", body: JSON.stringify(cust) }
      );
      if (!res.ok) {
        showToast(
          L("No changes", "Tiada perubahan"),
          res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"),
          "notice"
        );
        return;
      }
      showToast(
        L("Saved", "Disimpan"),
        L(`${cust.company} updated`, `${cust.company} dikemas kini`)
      );
    } else {
      await api(`/staff/customers`, {
        method: "POST",
        body: JSON.stringify(cust),
      });
      showToast(
        L("Saved", "Disimpan"),
        L(`${cust.company} added`, `${cust.company} ditambah`)
      );
    }
    setCust({
      company: "",
      contact_person: "",
      phone: "",
      email: "",
      address: "",
      website: "",
    });
    setEditingCust(null);
    void load();
  };
  const resetDocForm = () => {
    setDoc({
      doc_type: "QT",
      customer_id: -1,
      salesperson_id: 0,
      kind: "product",
      items: [{ name: "", qty: 1, unit_price_cents: 0 }],
      discount_cents: 0,
      tax_percent: 0,
      delivery_cents: 0,
      paid_received: false,
      reference: "",
      delivery_address: "",
      issuer: "a2z",
    });
    setDocDate("");
    setPaidDate("");
    setEditingDoc(null);
  };

  const createDoc = async () => {
    // v1.4.94: silent returns were why "nothing saved" — every stop now says why.
    if (doc.customer_id === -1) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Choose a customer first (Walk-in counts)",
          "Pilih pelanggan dahulu (Walk-in pun dikira)"
        ),
        "notice"
      );
      return;
    }
    if (doc.items.some((i) => !i.name.trim())) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Every line needs an item description",
          "Setiap baris memerlukan keterangan barang"
        ),
        "notice"
      );
      return;
    }
    /* v1.41.0: a product document's lines come from the catalogue — the
       server refuses a product line without a SKU, so stop it here with a
       friendlier message than a 400. */
    if (doc.kind !== "service" && doc.items.some((i) => !(i.sku ?? "").trim())) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Pick each product from the list — product lines need a SKU",
          "Pilih setiap produk daripada senarai — baris produk memerlukan SKU"
        ),
        "notice"
      );
      return;
    }
    if (doc.items.every((i) => !i.unit_price_cents)) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L("Enter a unit price (RM)", "Masukkan harga seunit (RM)"),
        "notice"
      );
      return;
    }
    /* v1.33.3 — tidy the detail lines HERE, not while he is typing. Blank
       lines and stray spaces must not reach the PDF (they print as empty
       bullets), but stripping them on every keystroke is what stopped him
       typing a space at all. Over ten lines is refused out loud rather than
       silently cut, which is what the old .slice(0, 10) did. */
    const MAX_SUB = 10;
    const overflowing = doc.items.find(
      (i) => (i.sub ?? []).filter((s) => s.trim()).length > MAX_SUB
    );
    if (overflowing) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          `"${overflowing.name}" has more than ${MAX_SUB} detail lines — trim it first`,
          `"${overflowing.name}" ada lebih ${MAX_SUB} baris butiran — sila kurangkan dahulu`
        ),
        "notice"
      );
      return;
    }
    const payload = {
      ...doc,
      items: doc.items.map((i) => {
        const sub = (i.sub ?? []).map((s) => s.trim()).filter(Boolean);
        return { ...i, name: i.name.trim(), sub: sub.length ? sub : undefined };
      }),
      salesperson_id: doc.salesperson_id || undefined,
      doc_date: docDate || undefined,
      paid_date: doc.paid_received
        ? paidDate || docDate || undefined
        : undefined,
    };
    if (editingDoc) {
      const res = await api<{
        stock?: Parameters<typeof stockToastLine>[0];
        error?: { message?: string };
      }>(`/staff/docs/${editingDoc.id}/edit`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showToast(
          L("No changes", "Tiada perubahan"),
          res.data?.error?.message ??
            L("Update failed — check access", "Kemas kini gagal — semak akses"),
          "notice"
        );
        return;
      }
      // v1.4.265: an edited product invoice re-balances stock — say what moved.
      showToast(
        L("Saved", "Disimpan"),
        L(
          `${editingDoc.doc_number} updated`,
          `${editingDoc.doc_number} dikemas kini`
        ) + stockToastLine(res.data?.stock)
      );
      const idP = editingDoc.id;
      resetDocForm();
      void load();
      void printDoc(idP); // fresh PDF straight after the fix
      return;
    }
    type StockMove = {
      deducted: { sku: string; qty: number; stock: number }[];
      unmatched: string[];
      short: string[];
    } | null;
    const res = await api<{
      id?: number;
      doc_number?: string;
      stock?: StockMove;
      error?: { message?: string };
    }>(`/staff/docs`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok || !res.data?.id) {
      showToast(
        L("No changes", "Tiada perubahan"),
        res.data?.error?.message ??
          L("Create failed — check access", "Gagal dibuat — semak akses"),
        "notice"
      );
      return;
    }
    showToast(
      L("Saved", "Disimpan"),
      L(
        `${res.data.doc_number ?? "Document"} created${doc.paid_received ? " — PAID" : ""}`,
        `${res.data.doc_number ?? "Dokumen"} dibuat${doc.paid_received ? " — DIBAYAR" : ""}`
      ) + stockToastLine(res.data.stock)
    );
    const newId = res.data.id;
    resetDocForm();
    await load(); // v1.4.97: awaited so the new document is visible in the list at once
    void printDoc(newId); // PDF opens immediately after creation
  };
  /* v1.4.244 (CEO: "I want the format can be deliver to my customer using
     mobile instead of I need to download using web view"): minting the link
     and handing it straight to the phone's share sheet — WhatsApp, Telegram,
     email, whatever they use — is two taps. No download, no file manager.
     Desktop has no share sheet, so the link goes to the clipboard instead. */
  /* v1.4.245 (CEO: "maybe we open the pdf then I can share to customer as a
     pdf instead of a link"): Send now builds the REAL PDF in the browser and
     hands the FILE to the phone's share sheet — one tap into WhatsApp, the
     customer receives a proper attachment. Three rungs, best first:
       1. share the file          (iOS 15+/Android Chrome)
       2. download the file       (desktop, older phones)
       3. share the v1.4.244 link (if the PDF could not be built at all) */
  const shareDoc = async (d: SalesDoc) => {
    const kind =
      {
        QT: L("Quotation", "Sebut Harga"),
        INV: L("Invoice", "Invois"),
        DO: L("Delivery Order", "Pesanan Penghantaran"),
      }[d.doc_type] ?? L("Document", "Dokumen");
    const filename = `${d.doc_number}.pdf`;
    let blob: Blob | null = null;
    try {
      const r = await fetch(`/api/v1/staff/docs/${d.id}`, {
        credentials: "include",
      });
      if (r.ok) {
        const { doc: full } = (await r.json()) as { doc: DocFull };
        blob = await buildDocPdf(full);
      }
    } catch {
      blob = null;
    }

    if (blob && typeof navigator.canShare === "function") {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `${kind} ${d.doc_number}`,
          });
          return;
        } catch {
          /* the sheet was dismissed — don't fall through to a download */
          return;
        }
      }
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(
        L("PDF ready", "PDF sedia"),
        L(
          `${filename} saved — attach it from your files`,
          `${filename} disimpan — lampirkan daripada fail anda`
        )
      );
      return;
    }

    const res = await api<{ url?: string; error?: { message?: string } }>(
      `/staff/docs/${d.id}/share`,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok || !res.data?.url) {
      showToast(
        L("No changes", "Tiada perubahan"),
        res.data?.error?.message ??
          L(
            "Could not prepare the document",
            "Tidak dapat menyediakan dokumen"
          ),
        "notice"
      );
      return;
    }
    const url = res.data.url;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${kind} ${d.doc_number}`, url });
        return;
      } catch {
        /* dismissed */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(
        L("Link ready", "Pautan sedia"),
        L(
          `${d.doc_number} — link copied, paste it to your customer`,
          `${d.doc_number} — pautan disalin, tampal kepada pelanggan anda`
        )
      );
    } catch {
      showToast(L("Link ready", "Pautan sedia"), url);
    }
  };
  const setStatus = async (
    d: SalesDoc,
    value: string,
    paymentRef?: string,
    paidOn?: string
  ) => {
    const body =
      d.doc_type === "INV"
        ? value === "paid"
          ? {
              payment_status: "paid",
              payment_method: "bank_transfer",
              payment_ref: paymentRef || undefined,
              paid_on: paidOn || undefined,
            }
          : { payment_status: value }
        : { delivery_status: value };
    await api(`/staff/docs/${d.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    void load();
  };

  /* v1.41.2 (CEO: "I saw total was not deduct when there is discount
     insert"): this preview and the Worker MUST compute the same number.
     Line discounts shipped in v1.4.243 and the server has subtracted them
     ever since — but this preview never did, so two RM 11.70 lines with
     RM 1.70 off each showed "Total: RM 23.40" while the created document
     said RM 20.00. Staff read one number, the customer got another.
     The formula below now mirrors staff.ts POST /docs term for term:
     per-line discount capped at the line's own value, then the document
     discount, then tax, then delivery — which the server zeroes on a DO
     AND on a service document (v1.4.238), not just on a DO. */
  const subtotal = doc.items.reduce(
    (s, i) =>
      s +
      i.qty * i.unit_price_cents -
      Math.min(i.disc_cents ?? 0, i.qty * i.unit_price_cents),
    0
  );
  // v1.4.160: delivery / postage fee — added after discount + tax (pass-through
  // charge, not taxable goods value); never on a Delivery Order or a service.
  const total =
    Math.max(
      0,
      Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100))
    ) +
    (doc.doc_type === "DO" || doc.kind === "service" ? 0 : doc.delivery_cents);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">
            {editingCust ? (
              <>
                {L("Editing", "Menyunting")} {editingCust.company}{" "}
                <button
                  type="button"
                  className="ml-1 text-xs font-normal underline"
                  onClick={() => {
                    setEditingCust(null);
                    setCust({
                      company: "",
                      contact_person: "",
                      phone: "",
                      email: "",
                      address: "",
                      website: "",
                    });
                  }}
                >
                  {L("cancel", "batal")}
                </button>
              </>
            ) : (
              L("Add customer", "Tambah pelanggan")
            )}
          </p>
          <div className="mt-3 space-y-3">
            <Sub t={L("Company *", "Syarikat *")}>
              <input
                className={inputClass}
                placeholder={L(
                  "e.g. Acme Retail Sdn Bhd",
                  "cth. Acme Retail Sdn Bhd"
                )}
                value={cust.company}
                onChange={(e) =>
                  setCust((c) => ({ ...c, company: e.target.value }))
                }
              />
            </Sub>
            <div className="grid grid-cols-2 gap-3">
              <Sub t={L("Contact person", "Orang hubungan")}>
                <input
                  className={inputClass}
                  placeholder={L("Full name", "Nama penuh")}
                  value={cust.contact_person}
                  onChange={(e) =>
                    setCust((c) => ({ ...c, contact_person: e.target.value }))
                  }
                />
              </Sub>
              <Sub t={L("Phone", "Telefon")}>
                <input
                  className={inputClass}
                  placeholder="+60 12-345 6789"
                  value={cust.phone}
                  onChange={(e) =>
                    setCust((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </Sub>
            </div>
            <Sub t={L("Email", "E-mel")}>
              <input
                className={inputClass}
                placeholder="name@company.com"
                value={cust.email}
                onChange={(e) =>
                  setCust((c) => ({ ...c, email: e.target.value }))
                }
              />
            </Sub>
            <Sub t={L("Address", "Alamat")}>
              {/* v1.4.235: prints on the customer's documents. */}
              <textarea
                className={`${inputClass} min-h-16`}
                placeholder={
                  "No. 12, Jalan Contoh 3/4,\nTaman Contoh, 81200 Johor Bahru, Johor"
                }
                value={cust.address}
                onChange={(e) =>
                  setCust((c) => ({ ...c, address: e.target.value }))
                }
              />
            </Sub>
            {/* v1.30.0 (CEO: "customer or client can have a option to click
                on their logo then will redirecting to their own domain"):
                the client's OWN address on the web, and their own mark. It
                lives on the client record — not in our site's code — so the
                tenth client works the same as the first with no deploy. */}
            <Sub t={L("Their website", "Laman web mereka")}>
              <input
                className={inputClass}
                placeholder="https://theirbrand.my"
                value={cust.website}
                onChange={(e) =>
                  setCust((c) => ({ ...c, website: e.target.value }))
                }
              />
            </Sub>
            {editingCust && (
              <Sub t={L("Their logo", "Logo mereka")}>
                <span className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const row = customers.find((c) => c.id === editingCust.id);
                    return row?.logo_key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/media/file/${encodeURIComponent(row.logo_key)}`}
                        alt={row.company}
                        className="border-border h-8 w-auto rounded border bg-white p-0.5"
                      />
                    ) : null;
                  })()}
                  <label className="border-border hover:bg-secondary inline-flex h-8 cursor-pointer items-center rounded-lg border px-2.5 text-xs">
                    {logoBusy === editingCust.id
                      ? L("Uploading…", "Memuat naik…")
                      : L("Upload logo", "Muat naik logo")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setLogoBusy(editingCust.id);
                        const r = await api<{ error?: { message?: string } }>(
                          `/staff/customers/${editingCust.id}/logo`,
                          {
                            method: "POST",
                            body: f,
                            headers: { "Content-Type": f.type },
                          }
                        );
                        setLogoBusy(null);
                        if (!r.ok) {
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            r.data?.error?.message ??
                              L("Upload failed", "Muat naik gagal"),
                            "notice"
                          );
                          return;
                        }
                        showToast(
                          L("Saved", "Disimpan"),
                          L(
                            `${editingCust.company} logo updated`,
                            `Logo ${editingCust.company} dikemas kini`
                          )
                        );
                        void load();
                      }}
                    />
                  </label>
                  <span className="text-muted-foreground text-[11px]">
                    {L(
                      "PNG, JPG, WEBP or SVG. Shown to this client in their own area, linking to their website.",
                      "PNG, JPG, WEBP atau SVG. Dipaparkan kepada klien ini di ruangan mereka, memaut ke laman web mereka."
                    )}
                  </span>
                </span>
              </Sub>
            )}
            <button
              type="button"
              className={btnClass}
              onClick={() => void addCustomer()}
            >
              {editingCust
                ? L("Update customer", "Kemas kini pelanggan")
                : L("Save customer", "Simpan pelanggan")}
            </button>
          </div>
          <div className="mt-3 max-h-56 overflow-y-auto">
            {customers.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {L("No customers yet.", "Tiada pelanggan lagi.")}
              </p>
            )}
            {customers.map((c) => (
              <div
                key={c.id}
                className="border-border border-b py-1.5 text-sm last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {/* v1.4.249: the company name opens the record — contact
                      details and both addresses were invisible in this list. */}
                    <RecordToggle
                      open={openCust === c.id}
                      title={L("Contact and addresses", "Hubungan dan alamat")}
                      onToggle={() =>
                        setOpenCust(openCust === c.id ? null : c.id)
                      }
                    >
                      {c.company}
                    </RecordToggle>
                    {c.contact_person && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {c.contact_person}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {docs.some(
                      (d) => d.doc_type === "INV" && d.company === c.company
                    ) && (
                      <button
                        type="button"
                        className="border-border hover:bg-secondary inline-flex h-7 items-center rounded-lg border px-2.5 text-xs"
                        title={L(
                          "Statement of Account — all invoices, paid + outstanding, printable",
                          "Penyata Akaun — semua invois, dibayar + tertunggak, boleh dicetak"
                        )}
                        onClick={() => printSOA(c.company, docs)}
                      >
                        SOA
                      </button>
                    )}
                    {/* v1.4.235: edit loads the record into the form above;
                      delete is refused by the server while documents exist. */}
                    <button
                      type="button"
                      className="border-border hover:bg-secondary inline-flex h-7 items-center rounded-lg border px-2.5 text-xs"
                      onClick={() => {
                        setEditingCust({ id: c.id, company: c.company });
                        setCust({
                          company: c.company,
                          contact_person: c.contact_person ?? "",
                          phone: c.phone ?? "",
                          email: c.email ?? "",
                          address:
                            (c as { address?: string | null }).address ?? "",
                          website: c.website ?? "",
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      ✎ {L("Edit", "Sunting")}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-lg border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        if (
                          !(await askConfirm({
                            title: L(
                              `Delete ${c.company}?`,
                              `Padam ${c.company}?`
                            ),
                            message: L(
                              "Only possible when they have no documents — quotations and invoices must keep their customer for records.",
                              "Hanya boleh apabila mereka tiada dokumen — sebut harga dan invois mesti mengekalkan pelanggannya untuk rekod."
                            ),
                            confirmLabel: L(
                              "Delete customer",
                              "Padam pelanggan"
                            ),
                            variant: "danger",
                          }))
                        )
                          return;
                        const res = await api<{ error?: { message?: string } }>(
                          `/staff/customers/${c.id}`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          showToast(
                            L("Deleted", "Dipadam"),
                            L(`${c.company} removed`, `${c.company} dibuang`)
                          );
                          if (editingCust?.id === c.id) {
                            setEditingCust(null);
                            setCust({
                              company: "",
                              contact_person: "",
                              phone: "",
                              email: "",
                              address: "",
                              website: "",
                            });
                          }
                          void load();
                        } else
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L("Delete refused", "Padam ditolak"),
                            "notice"
                          );
                      }}
                    >
                      {L("Delete", "Padam")}
                    </button>
                  </span>
                </div>
                {openCust === c.id && (
                  <DetailGrid
                    items={[
                      {
                        label: L("Contact", "Hubungan"),
                        value: c.contact_person ?? "",
                      },
                      { label: L("Phone", "Telefon"), value: c.phone ?? "" },
                      { label: L("Email", "E-mel"), value: c.email ?? "" },
                      {
                        label: L("Billing address", "Alamat bil"),
                        wide: true,
                        value: (c as { address?: string | null }).address ?? "",
                      },
                      {
                        label: L("Delivery address", "Alamat penghantaran"),
                        wide: true,
                        value:
                          (c as { delivery_address?: string | null })
                            .delivery_address ?? "",
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          {toastNode}
          {confirmNode}
          {promptNode}
          <p className="text-sm font-semibold">
            {editingDoc ? (
              <>
                {L("Editing", "Menyunting")} {editingDoc.doc_number}{" "}
                <button
                  type="button"
                  className="ml-1 text-xs font-normal underline"
                  onClick={resetDocForm}
                >
                  {L("cancel", "batal")}
                </button>
              </>
            ) : (
              L("Create document", "Buat dokumen")
            )}
          </p>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L("Document type", "Jenis dokumen")}
                </span>
                <select
                  className={inputClass}
                  value={doc.doc_type}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, doc_type: e.target.value }))
                  }
                >
                  <option value="QT">{L("Quotation", "Sebut harga")}</option>
                  {/* v1.4.234: a Delivery Order is product-only — nothing
                      physical ships for a service, so the option hides. */}
                  {doc.kind !== "service" && (
                    <option value="DO">
                      {L("Delivery Order", "Pesanan Penghantaran")}
                    </option>
                  )}
                  {canInvoice && (
                    <option value="INV">{L("Invoice", "Invois")}</option>
                  )}
                </select>
              </label>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L("Customer", "Pelanggan")}
                </span>
                <select
                  className={inputClass}
                  value={doc.customer_id}
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      customer_id: Number(e.target.value),
                    }))
                  }
                >
                  <option value={-1}>
                    {L("Choose customer…", "Pilih pelanggan…")}
                  </option>
                  <option value={0}>
                    {L(
                      "🚶 Walk-in / general buyer",
                      "🚶 Walk-in / pembeli umum"
                    )}
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company}
                    </option>
                  ))}
                </select>
              </label>
              {/* v1.30.1 (CEO: "letterhead should all under A2Z since A2Z is
                  a main company... only under AZ ONE if it is consultancy"):
                  the entity choice, at creation only. It decides the
                  letterhead, the registration number, the SST clause AND the
                  bank account the client is told to pay — which is why the
                  amber line spells that out before anyone presses Create,
                  and why the choice is locked once the document exists. */}
              {!editingDoc && (
                <label className="col-span-2 block">
                  <span className="text-muted-foreground mb-1 block text-xs">
                    {L(
                      "Issued by (letterhead + bank account)",
                      "Dikeluarkan oleh (kepala surat + akaun bank)"
                    )}
                  </span>
                  <select
                    className={inputClass}
                    value={doc.issuer}
                    onChange={(e) =>
                      setDoc((d) => ({ ...d, issuer: e.target.value }))
                    }
                  >
                    <option value="a2z">
                      {L(
                        "A2Z CREATIVE MARKETING — default",
                        "A2Z CREATIVE MARKETING — lalai"
                      )}
                    </option>
                    <option value="azoo">
                      {L(
                        "AZ ONE OFFICIAL — consultancy work",
                        "AZ ONE OFFICIAL — kerja perundingan"
                      )}
                    </option>
                  </select>
                  {doc.issuer === "azoo" && (
                    <span className="text-warning mt-1 block text-[11px] leading-snug">
                      {L(
                        "This document will carry AZ ONE OFFICIAL's letterhead and instruct payment to AZ ONE's Maybank account. Use only for consultancy work done as AZ ONE.",
                        "Dokumen ini akan membawa kepala surat AZ ONE OFFICIAL dan mengarahkan bayaran ke akaun Maybank AZ ONE. Guna hanya untuk kerja perundingan sebagai AZ ONE."
                      )}
                    </span>
                  )}
                </label>
              )}
            </div>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs">
                {L("This document is for", "Dokumen ini untuk")}
              </span>
              {/* v1.4.234 (CEO: 2 business lines — product vs service; "details
                  just filled by one details"): ONE line per document. The
                  choice tags the document, steers the item placeholder, and
                  removes Delivery Order for services. */}
              <div className="flex gap-2">
                {/* v1.27.0: the labels name the KIND of line, not one client.
                    ELFIA is an independent client brand, not an A2Z product,
                    and this form writes quotations for every customer. The
                    stored VALUES ("product" / "service") are untouched — they
                    are in the database on every document already. */}
                {(
                  [
                    ["product", "Product — client goods"],
                    ["service", "Service — agency work"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={
                      "h-9 flex-1 rounded-lg border px-3 text-xs font-medium " +
                      (doc.kind === k
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-secondary")
                    }
                    onClick={() =>
                      setDoc((d) => ({
                        ...d,
                        kind: k,
                        doc_type:
                          k === "service" && d.doc_type === "DO"
                            ? "QT"
                            : d.doc_type,
                        delivery_cents: k === "service" ? 0 : d.delivery_cents,
                      }))
                    }
                  >
                    {L(
                      label,
                      k === "product"
                        ? "Produk — barangan klien"
                        : "Perkhidmatan — kerja agensi"
                    )}
                  </button>
                ))}
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L(
                    "Document date (backdate allowed)",
                    "Tarikh dokumen (tarikh lampau dibenarkan)"
                  )}
                </span>
                <input
                  type="date"
                  className={inputClass}
                  value={docDate}
                  max={new Date(Date.now() + 8 * 3600 * 1000)
                    .toISOString()
                    .slice(0, 10)}
                  onChange={(e) => setDocDate(e.target.value)}
                />
              </label>
              {doc.doc_type === "INV" && doc.paid_received ? (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">
                    {L("Payment received date", "Tarikh bayaran diterima")}
                  </span>
                  <input
                    type="date"
                    className={inputClass}
                    value={paidDate}
                    max={new Date(Date.now() + 8 * 3600 * 1000)
                      .toISOString()
                      .slice(0, 10)}
                    onChange={(e) => setPaidDate(e.target.value)}
                  />
                </label>
              ) : (
                <span />
              )}
            </div>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs">
                {L(
                  "Sales person (who made this sale)",
                  "Jurujual (siapa yang membuat jualan ini)"
                )}
              </span>
              <select
                className={inputClass}
                value={doc.salesperson_id}
                onChange={(e) =>
                  setDoc((d) => ({
                    ...d,
                    salesperson_id: Number(e.target.value),
                  }))
                }
                title={L(
                  "Captured from your login automatically — change it only when creating on someone else's behalf",
                  "Diambil daripada log masuk anda secara automatik — tukar hanya apabila membuat bagi pihak orang lain"
                )}
              >
                {/* v1.41.1 (CEO: "the name of sales person to short, I dont
                    need their roles there. their name is require instead"):
                    the FULL name, nothing else. /staff-list already sends
                    full_name (falling back to the account name), so the
                    truncation to a first name + role was purely cosmetic —
                    and ambiguous the moment two staff shared a first name.
                    The "me" row keeps its auto-from-login hint because that
                    is function, not decoration. */}
                <option value={0}>
                  {L(
                    `${user.name} — me (auto from login)`,
                    `${user.name} — saya (auto dari log masuk)`
                  )}
                </option>
                {staffList
                  .filter((u) => u.name !== user.name)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
            {/* v1.4.243 (CEO's Malaysian-standard document): the buyer's own
                reference prints in the meta strip — "N/A" when blank — and a
                ship-to address prints beside the billing block. A service
                delivers nothing physical, so the address box is product-only
                (same rule as Delivery / postage since v1.4.238). */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L(
                    "Their reference / PO no. (optional)",
                    "Rujukan mereka / No. PO (pilihan)"
                  )}
                </span>
                <input
                  className={inputClass}
                  placeholder={L("e.g. PO-2608", "cth. PO-2608")}
                  maxLength={60}
                  value={doc.reference}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, reference: e.target.value }))
                  }
                />
              </label>
              {doc.kind === "product" ? (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">
                    {L(
                      "Delivery address (only if different)",
                      "Alamat penghantaran (hanya jika berbeza)"
                    )}
                  </span>
                  <input
                    className={inputClass}
                    placeholder={L(
                      "Leave blank — same as billing",
                      "Biarkan kosong — sama seperti bil"
                    )}
                    maxLength={300}
                    value={doc.delivery_address}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        delivery_address: e.target.value,
                      }))
                    }
                  />
                </label>
              ) : (
                <span />
              )}
            </div>
            <div className="text-muted-foreground hidden gap-2 text-xs sm:grid sm:grid-cols-[1fr_66px_66px_100px_100px_auto]">
              <span>
                {L(
                  "Item / service description",
                  "Keterangan barang / perkhidmatan"
                )}
              </span>
              <span>UOM</span>
              <span>{L("Qty", "Kuantiti")}</span>
              <span>{L("Unit price (RM)", "Harga seunit (RM)")}</span>
              <span>{L("Discount (RM)", "Diskaun (RM)")}</span>
              <span />
            </div>
            {doc.items.map((item, i) => {
              // one helper so every field on the line edits the same way
              const patch = (p: Partial<DocItem>) =>
                setDoc((d) => ({
                  ...d,
                  items: d.items.map((x, xi) =>
                    xi === i ? { ...x, ...p } : x
                  ),
                }));
              return (
                <div
                  key={i}
                  className="border-border grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_66px_66px_100px_100px_auto] sm:border-0 sm:p-0"
                >
                  {doc.kind === "service" ? (
                    <input
                      className={`${inputClass} col-span-2 sm:col-span-1`}
                      placeholder={L(
                        "e.g. TikTok LIVE hosting — 8 sessions",
                        "cth. Pengacaraan TikTok LIVE — 8 sesi"
                      )}
                      value={item.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  ) : (
                    /* v1.41.0 (CEO: "a list of the product with the prices
                       auto filled … SKU need to be filled for the products"):
                       product lines are PICKED, not typed. Choosing an item
                       fills name + SKU + the list price in one tap; the price
                       box locks (the Worker re-resolves it from Inventory
                       anyway) and any reduction goes in Disc, where it is
                       visible on the document instead of hidden inside a
                       hand-edited price. */
                    <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
                      <select
                        className={inputClass}
                        value={item.sku ?? ""}
                        title={L(
                          "Pick the product — price and SKU fill automatically from Inventory",
                          "Pilih produk — harga dan SKU diisi automatik daripada Inventori"
                        )}
                        onChange={(e) => {
                          const hit = invItems.find(
                            (it) => it.sku === e.target.value
                          );
                          if (!hit) {
                            patch({ sku: "", name: "", unit_price_cents: 0 });
                            return;
                          }
                          patch({
                            name: hit.name,
                            sku: hit.sku,
                            unit_price_cents: hit.unit_price_cents ?? 0,
                            uom: item.uom || "PCS",
                          });
                        }}
                      >
                        <option value="">
                          {invItems.some((it) => it.sku)
                            ? L("— pick a product —", "— pilih produk —")
                            : L(
                                "No products in Inventory yet — add them on the Inventory tab",
                                "Tiada produk dalam Inventori — tambah di tab Inventori"
                              )}
                        </option>
                        {invItems
                          .filter((it) => it.sku)
                          .slice()
                          .sort((a, b) => a.sku.localeCompare(b.sku))
                          .map((it) => (
                            <option key={it.sku} value={it.sku}>
                              {it.sku} — {it.name} — RM{" "}
                              {((it.unit_price_cents ?? 0) / 100).toFixed(2)}
                            </option>
                          ))}
                      </select>
                      {item.sku ? (
                        <span className="text-muted-foreground text-xs">
                          SKU <span className="font-mono">{item.sku}</span> ·{" "}
                          {L(
                            "list price locked — use Disc for any reduction",
                            "harga senarai dikunci — guna Diskaun untuk potongan"
                          )}
                        </span>
                      ) : null}
                    </div>
                  )}
                  <input
                    className={inputClass}
                    placeholder="UOM"
                    maxLength={12}
                    value={item.uom ?? ""}
                    title={L(
                      "Unit of measure — PCS, UNIT, SET, VIDEO, SESSION…",
                      "Unit ukuran — PCS, UNIT, SET, VIDEO, SESSION…"
                    )}
                    onChange={(e) =>
                      patch({ uom: e.target.value.toUpperCase() })
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={item.qty}
                    onChange={(e) => patch({ qty: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} ${doc.kind !== "service" && item.sku ? "opacity-70" : ""}`}
                    placeholder="0.00"
                    readOnly={doc.kind !== "service" && !!item.sku}
                    title={
                      doc.kind !== "service" && item.sku
                        ? L(
                            "List price from Inventory — change it there, or use Disc for a reduction on this document",
                            "Harga senarai daripada Inventori — ubah di sana, atau guna Diskaun untuk potongan pada dokumen ini"
                          )
                        : undefined
                    }
                    value={
                      item.unit_price_cents
                        ? (item.unit_price_cents / 100).toString()
                        : ""
                    }
                    onChange={(e) =>
                      patch({
                        unit_price_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    placeholder="0.00"
                    title={L(
                      "Discount on THIS line — the document-level discount stays separate",
                      "Diskaun pada baris INI — diskaun peringkat dokumen kekal berasingan"
                    )}
                    value={
                      item.disc_cents ? (item.disc_cents / 100).toString() : ""
                    }
                    onChange={(e) =>
                      patch({
                        disc_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      })
                    }
                  />
                  {doc.items.length > 1 ? (
                    <button
                      type="button"
                      className="text-destructive text-xs underline"
                      title={L("Remove this line", "Buang baris ini")}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          items: d.items.filter((_, xi) => xi !== i),
                        }))
                      }
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}
                  {/* v1.4.243: inclusions belong UNDER their line, not as extra
                    RM 0.00 rows — they print as bullets beneath the item.

                    v1.33.3 (CEO: "The desc on sales cant be space?! Whyyy" —
                    he typed "Testing Testing" and got "TestingTesting"). This
                    box round-trips its text through a string[] on EVERY
                    keystroke, and the old handler normalised on the way in:
                      .map(s => s.trim())  killed the space the moment it was
                                           typed, because a trailing space is
                                           leading/trailing on its own line
                      .filter(Boolean)     deleted a new blank line the moment
                                           Enter was pressed
                      .slice(0, 10)        silently dropped pasted line 11+
                    Typing is now a pure split — what you type is what is in
                    state. Tidying happens ONCE, at save (see createDoc), which
                    is the only moment it actually matters. */}
                  <textarea
                    className={`${inputClass} col-span-2 min-h-[4rem] sm:col-span-6`}
                    placeholder={L(
                      "Detail lines — one inclusion per line (optional). e.g. Storyboard",
                      "Baris butiran — satu perkara setiap baris (pilihan). cth. Storyboard"
                    )}
                    value={(item.sub ?? []).join("\n")}
                    onChange={(e) => patch({ sub: e.target.value.split("\n") })}
                  />
                </div>
              );
            })}
            {/* v1.41.0: the name-datalist is gone — product lines are picked
                from the catalogue select above (SKU + list price fill
                automatically), services are free text. */}
            <button
              type="button"
              className="text-xs underline"
              onClick={() =>
                setDoc((d) => ({
                  ...d,
                  items: [
                    ...d.items,
                    { name: "", qty: 1, unit_price_cents: 0 },
                  ],
                }))
              }
            >
              {L("+ Add line", "+ Tambah baris")}
            </button>
            <div
              className={`grid grid-cols-2 gap-3 ${doc.doc_type !== "DO" ? "sm:grid-cols-3" : ""}`}
            >
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L("Discount (RM, optional)", "Diskaun (RM, pilihan)")}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  placeholder="0.00"
                  value={
                    doc.discount_cents
                      ? (doc.discount_cents / 100).toString()
                      : ""
                  }
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      discount_cents: Math.max(
                        0,
                        Math.round(Number(e.target.value || 0) * 100)
                      ),
                    }))
                  }
                />
              </label>
              {/* v1.4.160: delivery / postage fee — quoted on the QT, billed on
                  the INV; a Delivery Order carries goods only (Malaysian
                  standard), so the field hides for DO. */}
              {/* v1.4.238: no Delivery / postage on a service document —
                  the box hides and the value zeroes when Service is picked;
                  the server forces 0 regardless. */}
              {doc.doc_type !== "DO" && doc.kind !== "service" && (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">
                    {L(
                      "Delivery / postage (RM, optional)",
                      "Penghantaran / pos (RM, pilihan)"
                    )}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    placeholder="0.00"
                    value={
                      doc.delivery_cents
                        ? (doc.delivery_cents / 100).toString()
                        : ""
                    }
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        delivery_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      }))
                    }
                  />
                </label>
              )}
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">
                  {L("Tax % (optional)", "Cukai % (pilihan)")}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={inputClass}
                  placeholder="0"
                  value={doc.tax_percent || ""}
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      tax_percent: Number(e.target.value || 0),
                    }))
                  }
                />
              </label>
            </div>
            {doc.doc_type === "INV" && (
              <label
                className="flex items-center gap-1.5 text-sm"
                title={L(
                  "Payment already in hand (e.g. bank transfer received) — the invoice is created as PAID and counts in revenue immediately",
                  "Bayaran sudah diterima (cth. pindahan bank) — invois dibuat sebagai DIBAYAR dan terus dikira dalam hasil"
                )}
              >
                <input
                  type="checkbox"
                  checked={doc.paid_received}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, paid_received: e.target.checked }))
                  }
                />
                {L(
                  "Payment already received (bank transfer)",
                  "Bayaran sudah diterima (pindahan bank)"
                )}
              </label>
            )}
            <p className="text-sm font-medium">
              {L("Total", "Jumlah")}: {fmtRM(total)}
            </p>
            <button
              type="button"
              className={btnClass}
              onClick={() => void createDoc()}
            >
              {editingDoc
                ? L(
                    `Update ${editingDoc.doc_number}`,
                    `Kemas kini ${editingDoc.doc_number}`
                  )
                : L("Create with auto number", "Buat dengan nombor auto")}
            </button>
          </div>
        </div>
      </div>

      {(() => {
        // v1.4.101: overdue invoice aging 30/60/90 + WhatsApp reminder link.
        const todayMs = Date.now() + 8 * 3600 * 1000;
        const unpaid = docs.filter(
          (d) => d.doc_type === "INV" && d.payment_status !== "paid"
        );
        if (unpaid.length === 0) return null;
        const age = (d: SalesDoc) =>
          Math.floor(
            (todayMs -
              new Date(d.created_at.slice(0, 10) + "T00:00:00Z").getTime()) /
              86400000
          );
        const bucket = (n: number) =>
          n <= 30
            ? [L("1–30 days", "1–30 hari"), "bg-amber-100 text-amber-800"]
            : n <= 60
              ? [L("31–60 days", "31–60 hari"), "bg-orange-100 text-orange-800"]
              : n <= 90
                ? [L("61–90 days", "61–90 hari"), "bg-red-100 text-red-700"]
                : [L("90+ days", "90+ hari"), "bg-red-200 text-red-800"];
        return (
          <div className={card}>
            <p className="text-sm font-semibold">
              ⏳ {L("Outstanding invoices — aging", "Invois tertunggak — usia")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L(
                "Unpaid invoices by age. WhatsApp opens a pre-written reminder with the invoice number, amount and bank details.",
                "Invois belum dibayar mengikut usia. WhatsApp membuka peringatan sedia tulis dengan nombor invois, amaun dan butiran bank."
              )}
            </p>
            <div className="mt-2 space-y-1.5">
              {unpaid
                .sort((a, b) => age(b) - age(a))
                .map((d) => {
                  const n = age(d);
                  const [label, cls] = bucket(n);
                  const phone = (d.customer_phone ?? "").replace(/[^0-9]/g, "");
                  /* v1.28.0: the chase names the INVOICE's issuer and ITS bank
                   account — the customer must pay the entity that invoiced
                   them, so a legacy AZ ONE invoice keeps AZ ONE's account and
                   an A2Z invoice names A2Z's (resolveIssuer on the row). */
                  const iss = resolveIssuer(d.issuer_code);
                  const msg = encodeURIComponent(
                    `Hi! Gentle reminder from ${iss.name} — invoice ${d.doc_number} (${fmtRM(d.total_cents)}) is still outstanding. Kindly settle by bank transfer to ${bankTransferLine(iss)}, quoting the invoice number. Thank you!`
                  );
                  return (
                    <div
                      key={d.id}
                      className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-1.5 text-sm last:border-0"
                    >
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="font-medium">{d.doc_number}</span>
                        {d.kind && (
                          <span
                            title={
                              d.kind === "service"
                                ? L("Service document", "Dokumen perkhidmatan")
                                : L("Product document", "Dokumen produk")
                            }
                          >
                            {" "}
                            {d.kind === "service" ? "🛠" : "📦"}
                          </span>
                        )}{" "}
                        · {d.company} · {fmtRM(d.total_cents)}
                        <span className="text-muted-foreground">
                          {" "}
                          · {n} {L("days", "hari")}
                        </span>
                      </span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                        <span
                          className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ${cls}`}
                        >
                          {label}
                        </span>
                        {phone ? (
                          <a
                            className="inline-flex h-7 items-center rounded-lg bg-green-600 px-2.5 text-xs font-medium text-white"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://wa.me/${phone.startsWith("60") ? phone : "6" + phone}?text=${msg}`}
                          >
                            {L("WhatsApp reminder", "Peringatan WhatsApp")}
                          </a>
                        ) : (
                          <span
                            className="text-muted-foreground inline-flex h-7 items-center text-xs"
                            title={L(
                              "Add a phone number on the customer record to enable one-tap reminders",
                              "Tambah nombor telefon pada rekod pelanggan untuk membolehkan peringatan satu sentuhan"
                            )}
                          >
                            {L("no phone", "tiada telefon")}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })()}

      <div className={card}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{L("Documents", "Dokumen")}</p>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => void load()}
          >
            {L("Refresh", "Muat semula")}
          </button>
        </div>
        {docsError && (
          <p className="mt-2 text-sm font-medium text-amber-700">{docsError}</p>
        )}
        {!docsError && docs.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No documents yet.", "Tiada dokumen lagi.")}
          </p>
        )}
        <div className="max-h-96 overflow-y-auto">
          {docs.map((d) => (
            <div
              key={d.id}
              className="border-border border-b py-2 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* v1.4.248 (CEO: "a minimalist version … click at the document
                number can appear the details. the button remain at outside"):
                the row carries only what identifies the document. Status
                chips, the payment/delivery pickers and the dates live in the
                panel below, opened by clicking the number. Actions stay on
                the row so nothing needs opening to be done. */}
                <span className="min-w-0 flex-1 basis-64">
                  <RecordToggle
                    open={openDoc === d.id}
                    title={L(
                      "Payment, dates and reference",
                      "Bayaran, tarikh dan rujukan"
                    )}
                    onToggle={() => setOpenDoc(openDoc === d.id ? null : d.id)}
                  >
                    {d.doc_number}
                  </RecordToggle>
                  {/* v1.30.1 — which entity's letterhead this document carries.
                  Only the exception is tagged: A2Z is the default and a chip
                  on every row would be noise. NULL (legacy) and "azoo" both
                  render AZ ONE, so both get the tag — one glance answers
                  "whose bank account is this client paying?". */}
                  {(d.issuer_code ?? null) !== "a2z" && (
                    <span
                      className="bg-secondary ml-1 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium"
                      title={L(
                        "Issued under AZ ONE OFFICIAL — AZ ONE letterhead and bank account",
                        "Dikeluarkan di bawah AZ ONE OFFICIAL — kepala surat dan akaun bank AZ ONE"
                      )}
                    >
                      AZ ONE
                    </span>
                  )}
                  {d.kind && (
                    <span
                      title={
                        d.kind === "service"
                          ? L("Service document", "Dokumen perkhidmatan")
                          : L("Product document", "Dokumen produk")
                      }
                    >
                      {" "}
                      {d.kind === "service" ? "🛠" : "📦"}
                    </span>
                  )}{" "}
                  · {d.company} · {fmtRM(d.total_cents)}
                </span>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {d.doc_type === "INV" && canInvoice && (
                    <select
                      className="border-input bg-background h-7 rounded-lg border px-2 text-xs"
                      value={d.payment_status ?? "unpaid"}
                      title={L(
                        "Mark paid when the bank transfer lands — revenue counts payments received",
                        "Tanda dibayar apabila pindahan bank diterima — hasil mengira bayaran diterima"
                      )}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "paid") {
                          void (async () => {
                            /* v1.4.250: the DATE the money actually landed, not the
                          moment the box was ticked. Revenue counts invoices by
                          paid_at, so a Friday transfer entered on Monday used
                          to land in the wrong day — and, at a month boundary,
                          the wrong month. Defaults to today, capped at today. */
                            const today = mytToday();
                            const got = await askText({
                              title: L("Payment received", "Bayaran diterima"),
                              message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                              label: L(
                                "Bank transfer reference (optional)",
                                "Rujukan pindahan bank (pilihan)"
                              ),
                              placeholder: L(
                                "e.g. MBB240726-8891",
                                "cth. MBB240726-8891"
                              ),
                              confirmLabel: L("Mark paid", "Tanda dibayar"),
                              date: {
                                label: L(
                                  "Date the payment was received",
                                  "Tarikh bayaran diterima"
                                ),
                                initial: today,
                                max: today,
                              },
                            });
                            if (got === null) return; // cancelled — status unchanged
                            await setStatus(
                              d,
                              "paid",
                              got.value || undefined,
                              got.date || undefined
                            );
                          })();
                        } else {
                          void setStatus(d, v);
                        }
                      }}
                    >
                      {["unpaid", "paid", "overdue"].map((sx) => (
                        <option key={sx} value={sx}>
                          {payStatusL(sx)}
                        </option>
                      ))}
                    </select>
                  )}
                  {d.doc_type === "DO" && (
                    <select
                      className="border-input bg-background h-7 rounded-lg border px-2 text-xs"
                      value={d.delivery_status ?? "pending"}
                      onChange={(e) => void setStatus(d, e.target.value)}
                    >
                      {["pending", "delivered"].map((sx) => (
                        <option key={sx} value={sx}>
                          {payStatusL(sx)}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* v1.4.233 (CEO: "reversal button … if accidentally click
                invoice"): only on an INV that came from a QT and is still
                unpaid — a paid invoice can never be reversed. Deletes the
                accidental invoice; the quotation stands untouched. */}
                  {d.doc_type === "INV" &&
                    d.converted_from != null &&
                    d.payment_status !== "paid" &&
                    canInvoice && (
                      <button
                        type="button"
                        className="inline-flex h-7 items-center rounded-lg border border-amber-700 px-2.5 text-xs font-medium text-amber-800"
                        title={L(
                          "Undo the Quotation → Invoice click: deletes this unpaid invoice; the quotation is untouched",
                          "Batalkan klik Sebut harga → Invois: memadam invois belum dibayar ini; sebut harga tidak disentuh"
                        )}
                        onClick={async () => {
                          if (
                            !(await askConfirm({
                              title: L(
                                `Reverse ${d.doc_number}?`,
                                `Terbalikkan ${d.doc_number}?`
                              ),
                              message: L(
                                "This deletes the invoice (it was created from a quotation and is still unpaid).\nThe quotation itself is not touched.",
                                "Ini memadam invois (ia dibuat daripada sebut harga dan masih belum dibayar).\nSebut harga itu sendiri tidak disentuh."
                              ),
                              confirmLabel: L(
                                "Reverse invoice",
                                "Terbalikkan invois"
                              ),
                              variant: "danger",
                            }))
                          )
                            return;
                          const res = await api<{
                            error?: { message?: string };
                          }>(`/staff/docs/${d.id}/unconvert`, {
                            method: "POST",
                            body: JSON.stringify({}),
                          });
                          if (res.ok) {
                            showToast(
                              L("Reversed", "Diterbalikkan"),
                              L(
                                `${d.doc_number} deleted — the quotation stands`,
                                `${d.doc_number} dipadam — sebut harga kekal`
                              )
                            );
                            await load();
                          } else
                            showToast(
                              L("No changes", "Tiada perubahan"),
                              res.data?.error?.message ??
                                L("Reversal failed", "Pembalikan gagal"),
                              "notice"
                            );
                        }}
                      >
                        ↩ {L("Undo", "Batalkan")}
                      </button>
                    )}
                  {d.doc_type === "QT" && canInvoice && (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-lg bg-[#1A2946] px-2.5 text-xs font-medium text-white"
                      title={L(
                        "One click Quotation → Invoice: same items, customer and sales person, fresh INV number",
                        "Satu klik Sebut harga → Invois: barang, pelanggan dan jurujual sama, nombor INV baharu"
                      )}
                      onClick={async () => {
                        const res = await api<{
                          id?: number;
                          doc_number?: string;
                          stock?: Parameters<typeof stockToastLine>[0];
                          error?: { message?: string };
                        }>(`/staff/docs/${d.id}/convert`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
                        if (!res.ok || !res.data?.id) {
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L(
                                "Conversion failed — check access",
                                "Penukaran gagal — semak akses"
                              ),
                            "notice"
                          );
                          return;
                        }
                        showToast(
                          L("Saved", "Disimpan"),
                          `${d.doc_number} → ${res.data.doc_number}${stockToastLine(res.data.stock)}`
                        );
                        await load();
                        void printDoc(res.data.id);
                      }}
                    >
                      → {L("Invoice", "Invois")}
                    </button>
                  )}
                  {d.doc_type === "QT" && !canInvoice && (
                    <span className="text-muted-foreground inline-flex h-7 items-center text-xs">
                      {L("Quotation", "Sebut harga")}
                    </span>
                  )}
                  <button
                    type="button"
                    className="border-border hover:bg-secondary inline-flex h-7 items-center rounded-lg border px-2.5 text-xs"
                    title={L(
                      "Fix a typo — loads the document into the form; the number never changes",
                      "Betulkan silap taip — memuatkan dokumen ke dalam borang; nombor tidak berubah"
                    )}
                    onClick={async () => {
                      const r = await fetch(`/api/v1/staff/docs/${d.id}`, {
                        credentials: "include",
                      });
                      if (!r.ok) return;
                      const { doc: full } = (await r.json()) as {
                        doc: DocFull & {
                          customer_id?: number;
                          salesperson_id?: number | null;
                        };
                      };
                      let its: DocItem[] = [];
                      try {
                        its = JSON.parse(full.items);
                      } catch {
                        its = [];
                      }
                      setDoc({
                        doc_type: full.doc_type,
                        customer_id:
                          (full as { customer_id?: number }).customer_id ?? -1,
                        salesperson_id:
                          (full as { salesperson_id?: number | null })
                            .salesperson_id ?? 0,
                        items: its.length
                          ? its
                          : [{ name: "", qty: 1, unit_price_cents: 0 }],
                        discount_cents: full.discount_cents ?? 0,
                        tax_percent: full.tax_percent ?? 0,
                        delivery_cents:
                          (full as { delivery_cents?: number })
                            .delivery_cents ?? 0,
                        paid_received: false,
                        kind:
                          (full as { kind?: string | null }).kind ?? "product",
                        reference:
                          (full as { reference?: string | null }).reference ??
                          "",
                        delivery_address:
                          (full as { delivery_address?: string | null })
                            .delivery_address ?? "",
                        /* the entity never changes after creation — carried only so
                     the state shape stays complete; the worker ignores it. */
                        issuer:
                          (full as { issuer_code?: string | null })
                            .issuer_code === "azoo"
                            ? "azoo"
                            : "a2z",
                      });
                      setDocDate(full.created_at.slice(0, 10));
                      setEditingDoc({ id: d.id, doc_number: d.doc_number });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {L("Edit", "Sunting")}
                  </button>
                  <button
                    type="button"
                    className={rowBtn}
                    onClick={() => void printDoc(d.id)}
                  >
                    PDF
                  </button>
                  {/* v1.4.258: NOT primary. A quotation row already has → Invoice
                filled, and v1.4.253's own rule is at most ONE fill per row —
                two dark blocks and neither reads as the main action. */}
                  <button
                    type="button"
                    className={rowBtn}
                    title={L(
                      "Send the PDF to the customer — opens your phone's share sheet with the file attached",
                      "Hantar PDF kepada pelanggan — membuka helaian kongsi telefon anda dengan fail dilampirkan"
                    )}
                    onClick={() => void shareDoc(d)}
                  >
                    {L("Send PDF", "Hantar PDF")}
                  </button>
                  {/* v1.4.237 (CEO): delete with confirm; a PAID invoice is
                refused by the server. Aging recomputes from this list, so
                a deleted unpaid invoice drops out of it immediately. */}
                  {canInvoice && (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-lg border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        if (
                          !(await askConfirm({
                            title: L(
                              `Delete ${d.doc_number}?`,
                              `Padam ${d.doc_number}?`
                            ),
                            message: L(
                              `${d.doc_type === "INV" ? "It will disappear from Documents and from Outstanding invoices — aging." : "It will disappear from Documents."}\nThis cannot be undone.`,
                              `${d.doc_type === "INV" ? "Ia akan hilang daripada Dokumen dan daripada Invois tertunggak — usia." : "Ia akan hilang daripada Dokumen."}\nIni tidak boleh dibatalkan.`
                            ),
                            confirmLabel: L("Delete document", "Padam dokumen"),
                            variant: "danger",
                          }))
                        )
                          return;
                        const res = await api<{ error?: { message?: string } }>(
                          `/staff/docs/${d.id}`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          showToast(
                            L("Deleted", "Dipadam"),
                            L(
                              `${d.doc_number} removed`,
                              `${d.doc_number} dibuang`
                            )
                          );
                          await load();
                        } else
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L("Delete refused", "Padam ditolak"),
                            "notice"
                          );
                      }}
                    >
                      {L("Delete", "Padam")}
                    </button>
                  )}
                </span>
              </div>
              {openDoc === d.id && (
                <DetailGrid
                  items={[
                    {
                      label: L("Type", "Jenis"),
                      value: `${{ QT: L("Quotation", "Sebut harga"), INV: L("Invoice", "Invois"), DO: L("Delivery Order", "Pesanan Penghantaran") }[d.doc_type] ?? d.doc_type}${d.kind ? ` · ${d.kind === "service" ? L("Service", "Perkhidmatan") : L("Product", "Produk")}` : ""}`,
                    },
                    {
                      label: L("Date", "Tarikh"),
                      value: dmy(d.created_at.slice(0, 10)),
                    },
                    {
                      label: L("Sales person", "Jurujual"),
                      value: d.salesperson_name
                        ? firstName(d.salesperson_name)
                        : "",
                    },
                    {
                      label: L("Customer phone", "Telefon pelanggan"),
                      value: d.customer_phone ?? "",
                    },
                    {
                      label: L("Payment", "Bayaran"),
                      wide: true,
                      value:
                        d.doc_type !== "INV" ? (
                          ""
                        ) : d.payment_status === "paid" ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-green-700">
                              {L(
                                "PAID · bank transfer",
                                "DIBAYAR · pindahan bank"
                              )}
                            </span>
                            {d.paid_at && (
                              <span className="text-muted-foreground">
                                {dmy(d.paid_at.slice(0, 10))}
                              </span>
                            )}
                            {d.payment_ref && (
                              <span className="text-muted-foreground">
                                {L("Ref", "Ruj")} {d.payment_ref}
                              </span>
                            )}
                            {/* v1.4.250: the date is correctable without unmarking the
                      invoice — unmarking would clear the reference too. */}
                            {canInvoice && (
                              <button
                                type="button"
                                className="underline"
                                title={L(
                                  "Correct the date the payment was received",
                                  "Betulkan tarikh bayaran diterima"
                                )}
                                onClick={async () => {
                                  const today = mytToday();
                                  const got = await askText({
                                    title: L(
                                      "Correct the payment date",
                                      "Betulkan tarikh bayaran"
                                    ),
                                    message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                                    label: L(
                                      "Bank transfer reference (optional)",
                                      "Rujukan pindahan bank (pilihan)"
                                    ),
                                    initial: d.payment_ref ?? "",
                                    confirmLabel: L("Save", "Simpan"),
                                    date: {
                                      label: L(
                                        "Date the payment was received",
                                        "Tarikh bayaran diterima"
                                      ),
                                      initial: d.paid_at
                                        ? d.paid_at.slice(0, 10)
                                        : today,
                                      max: today,
                                    },
                                  });
                                  if (got === null) return;
                                  await setStatus(
                                    d,
                                    "paid",
                                    got.value || undefined,
                                    got.date || undefined
                                  );
                                }}
                              >
                                ✎ {L("change date", "tukar tarikh")}
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            {payStatusL(d.payment_status ?? "unpaid")}
                          </span>
                        ),
                    },
                    {
                      label: L("Origin", "Asal"),
                      wide: true,
                      value:
                        d.converted_from != null
                          ? L(
                              "Converted from a quotation",
                              "Ditukar daripada sebut harga"
                            )
                          : "",
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= Profile ================= */

function Profile() {
  const [profile, setProfile] = useState<Record<string, string | null>>({});
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  useEffect(() => {
    void api<{ profile: Record<string, string | null> }>(`/staff/profile`).then(
      (r) => {
        if (r.data?.profile) {
          setProfile(r.data.profile);
          setPhone(r.data.profile.phone ?? "");
        }
      }
    );
  }, []);
  const save = async () => {
    if (phone === (profile.phone ?? "")) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L("Phone number unchanged", "Nombor telefon tidak berubah"),
        "notice"
      );
      return;
    }
    setSaving(true);
    const res = await api(`/staff/profile`, {
      method: "PATCH",
      body: JSON.stringify({ phone }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setProfile((pr) => ({ ...pr, phone }));
      setTimeout(() => setSaved(false), 2000);
      showToast(
        L("Saved", "Disimpan"),
        L("Phone number updated", "Nombor telefon dikemas kini")
      );
    } else {
      alert(L("Failed to save phone number", "Gagal menyimpan nombor telefon"));
    }
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
      <div className={card}>
        <p className="text-sm font-semibold">
          {L("My profile", "Profil saya")}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {[
            "name",
            "email",
            "role",
            "employee_id",
            "position",
            "department",
            "employment_status",
          ].map((k) => (
            <div key={k}>
              <dt className="text-muted-foreground text-[11px] capitalize">
                {getLang() === "ms"
                  ? ((
                      {
                        name: "nama",
                        email: "e-mel",
                        role: "peranan",
                        employee_id: "id pekerja",
                        position: "jawatan",
                        department: "jabatan",
                        employment_status: "status pekerjaan",
                      } as Record<string, string>
                    )[k] ?? k.replace("_", " "))
                  : k.replace("_", " ")}
              </dt>
              <dd className="font-medium break-words">{profile[k] ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {toastNode}
        <label className="mt-4 block">
          <span className="text-muted-foreground mb-1 block text-xs">
            {L(
              "Phone (you can update this)",
              "Telefon (anda boleh kemas kini)"
            )}
          </span>
          <input
            className={inputClass}
            placeholder="+60 12-345 6789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={saving}
          className={`${btnClass} mt-3`}
          onClick={() => void save()}
        >
          {saving
            ? L("Saving...", "Menyimpan...")
            : saved
              ? L("Saved!", "Disimpan!")
              : L("Save", "Simpan")}
        </button>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">
          {L("Change password", "Tukar kata laluan")}
        </p>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">
          {L(
            "Changing your password signs you out on every other device immediately. Google sign-in accounts manage their password with Google instead.",
            "Menukar kata laluan anda akan melog keluar semua peranti lain serta-merta. Akaun log masuk Google mengurus kata laluan mereka dengan Google."
          )}
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}

/* ================= Shell ================= */

/* ================= Users (v1.4.101 — super_admin / CEO / COO) ================= */

/** v1.4.153: audit timestamps arrive as UTC "YYYY-MM-DD HH:MM:SS" — show MYT. */
function mytStamp2(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  const m = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m.getUTCDate())}-${p(m.getUTCMonth() + 1)}-${m.getUTCFullYear()} ${p(m.getUTCHours())}:${p(m.getUTCMinutes())} MYT`;
}

function UsersPanel({ role }: { role: string }) {
  const [rows, setRows] = useState<
    {
      id: number;
      name: string;
      full_name?: string | null;
      email: string;
      role: string;
      employment_status?: string | null;
      is_active: number;
      left_on?: string | null;
      rejoined_on?: string | null;
      totp_enabled?: number;
    }[]
  >([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<
    {
      action: string;
      created_at: string;
      name?: string | null;
      email?: string | null;
    }[]
  >([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY — Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  const canEdit = role === "super_admin";
  const ROLE_OPTIONS = [
    "customer",
    "live_host",
    "editor",
    "marketing",
    "sales_marketing",
    "hr_admin",
    "cco",
    "coo",
    "ceo",
  ];
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    role: string;
    employment_status: string;
  }>({ role: "live_host", employment_status: "part_time" });
  const { show: showToast, node: toastNode } = useSaveToast();
  const load = useCallback(() => {
    void api<{ users?: typeof rows; staff?: typeof rows }>(`/staff/users`).then(
      (r) => {
        if (r.ok && r.data)
          setRows(
            (r.data.users ?? r.data.staff ?? []).filter(
              (u) => !["super_admin", "admin"].includes(u.role)
            )
          );
        else
          setMsg(
            L(
              "Could not load user accounts — check access.",
              "Tidak dapat memuatkan akaun pengguna — semak akses."
            )
          );
      }
    );
    void api<{ events: typeof events }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const saveRole = async (u: { id: number; name: string; email: string }) => {
    const res = await api<{
      role?: string;
      employment_status?: string;
      error?: { message?: string };
    }>(`/staff/users/${u.id}/role`, {
      method: "POST",
      body: JSON.stringify({
        role: draft.role,
        employment_status: draft.employment_status,
      }),
    });
    if (res.ok) {
      showToast(
        L("Saved", "Disimpan"),
        `${firstName(u.name)} → ${draft.role.replace(/_/g, " ")} (${(res.data?.employment_status ?? draft.employment_status).replace(/_/g, " ")})`
      );
      setEditId(null);
      load();
    } else {
      showToast(
        L("Not saved", "Tidak disimpan"),
        res.data?.error?.message ??
          L("Role change failed", "Penukaran peranan gagal"),
        "notice"
      );
    }
  };
  const roleEditor = (u: {
    id: number;
    name: string;
    email: string;
    role: string;
    employment_status?: string | null;
  }) => (
    <div className="bg-secondary/40 mt-2 grid w-full grid-cols-2 items-end gap-2 rounded-lg p-2 sm:flex sm:flex-wrap">
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
          {L("Role", "Peranan")}
        </span>
        <select
          className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
          {L("Employment status", "Status pekerjaan")}
        </span>
        <select
          className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.employment_status}
          onChange={(e) =>
            setDraft((d) => ({ ...d, employment_status: e.target.value }))
          }
        >
          {EMP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="bg-primary text-primary-foreground col-span-1 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium"
        onClick={() => void saveRole(u)}
      >
        {L("Save", "Simpan")}
      </button>
      <button
        type="button"
        className="text-xs underline"
        onClick={() => setEditId(null)}
      >
        {L("Cancel", "Batal")}
      </button>
      {!u.email.toLowerCase().endsWith("@azoneofficial.com") &&
        draft.role !== "customer" && (
          <p className="text-muted-foreground col-span-2 w-full text-[11px]">
            {L(
              "Personal-email (Google) account — staff roles are saved as",
              "Akaun e-mel peribadi (Google) — peranan kakitangan disimpan sebagai"
            )}{" "}
            <span className="font-medium">
              {L("part time", "separuh masa")}
            </span>
            {L(
              "; permanent staff need an @azoneofficial.com account.",
              "; kakitangan tetap memerlukan akaun @azoneofficial.com."
            )}
          </p>
        )}
    </div>
  );
  const staffRows = rows.filter((u) => u.role !== "customer");
  const customerRows = rows.filter((u) => u.role === "customer");
  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">
        {L("User accounts", "Akaun pengguna")}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {canEdit
          ? L(
              "Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin.",
              "Tukar peranan menetapkan peranan dan status pekerjaan akaun — kakitangan separuh masa tidak layak OT. Kata laluan dan penyahaktifan kekal di /admin."
            )
          : L(
              "Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role.",
              "Baca sahaja di sini — penukaran peranan dibuat oleh super admin sistem sahaja, jadi tiada akaun perniagaan yang log masuk (atau log masuk Google yang dicerobohi) boleh menaikkan peranan."
            )}
      </p>
      {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      {/* v1.4.161: staff + customer lists sit side-by-side on desktop to cut
          the scroll in half; they stack normally on phones. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div>
          {/* v1.4.167: both columns carry the same heading + one-line description
          structure so the two list boxes top-align (the CEO's screenshot
          showed the customer box starting lower). */}
          <p className="mt-4 text-sm font-semibold lg:mt-0">
            {L("Staff accounts", "Akaun kakitangan")}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {L(
              "Role always shows — chips flag exceptions only (part-time, disabled, missing 2FA).",
              "Peranan sentiasa dipaparkan — cip menanda pengecualian sahaja (separuh masa, dinyahaktif, tiada 2FA)."
            )}
          </p>
          {/* v1.4.161 (CEO: "minimalist the card box — too long to scroll"):
          one bordered box with hairline-divided single-line rows instead of
          stacked card boxes; chips show EXCEPTIONS only (non-permanent
          status, disabled, 2FA missing) — role always shows. Everything
          truncates so a phone row stays one line. */}
          <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
            {staffRows.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {properName(u.full_name || u.name)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {u.email}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  <span className="bg-secondary rounded-full px-1.5 py-px text-[10px] capitalize">
                    {u.role.replace(/_/g, " ")}
                  </span>
                  {(u.employment_status ?? "permanent") !== "permanent" && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] capitalize ${["resigned", "terminated"].includes(u.employment_status ?? "") ? "bg-red-100 text-red-700" : "bg-secondary"}`}
                      title={`${u.left_on ? L(`until ${dmy(u.left_on)}`, `sehingga ${dmy(u.left_on)}`) : ""}${u.rejoined_on ? L(` · rejoined ${dmy(u.rejoined_on)}`, ` · kembali ${dmy(u.rejoined_on)}`) : ""}`}
                    >
                      {(u.employment_status ?? "").replace(/_/g, " ")}
                    </span>
                  )}
                  {!u.is_active && (
                    <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">
                      {L("disabled", "dinyahaktif")}
                    </span>
                  )}
                  {!u.totp_enabled && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800">
                      2FA ✗
                    </span>
                  )}
                  {canEdit && editId !== u.id && (
                    <button
                      type="button"
                      className="text-[11px] underline"
                      onClick={() => {
                        setEditId(u.id);
                        setDraft({
                          role: u.role,
                          employment_status:
                            u.employment_status &&
                            [
                              "permanent",
                              "contract",
                              "part_time",
                              "probation",
                            ].includes(u.employment_status)
                              ? u.employment_status
                              : "permanent",
                        });
                      }}
                    >
                      ✎
                    </button>
                  )}
                </span>
                {editId === u.id && roleEditor(u)}
              </div>
            ))}
          </div>
          {staffRows.some((u) => !u.totp_enabled && u.is_active) && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              ⚠ {staffRows.filter((u) => !u.totp_enabled && u.is_active).length}{" "}
              {L(
                "active account(s) without 2FA — worth chasing:",
                "akaun aktif tanpa 2FA — perlu dikejar:"
              )}{" "}
              {staffRows
                .filter((u) => !u.totp_enabled && u.is_active)
                .map((u) => firstName(u.name))
                .join(", ")}
            </p>
          )}
        </div>

        {/* v1.4.156: Google sign-ups land here as customers — the CEO promotes
          them into part-time roles (e.g. part-time live host) from this list. */}
        <div className="border-border mt-4 border-t pt-3 lg:mt-0 lg:border-t-0 lg:pt-0">
          <p className="text-sm font-semibold">
            {L(
              "Customer accounts — Google & self sign-ups",
              "Akaun pelanggan — Google & daftar sendiri"
            )}
          </p>
          <p
            className="text-muted-foreground mt-0.5 truncate text-xs"
            title={
              canEdit
                ? L(
                    "Personal emails can hold part-time roles only (e.g. part-time live host); permanent staff need an @azoneofficial.com account.",
                    "E-mel peribadi hanya boleh memegang peranan separuh masa (cth. hos LIVE separuh masa); kakitangan tetap memerlukan akaun @azoneofficial.com."
                  )
                : L(
                    "Google and self sign-ups always land here as customers with zero staff access.",
                    "Pendaftaran Google dan sendiri sentiasa mendarat di sini sebagai pelanggan tanpa akses kakitangan."
                  )
            }
          >
            {canEdit
              ? L(
                  "Promote here when someone joins — personal emails hold part-time roles only.",
                  "Naik taraf di sini apabila seseorang menyertai — e-mel peribadi memegang peranan separuh masa sahaja."
                )
              : L(
                  "Sign-ups land here with zero staff access — promotions by the super admin only.",
                  "Pendaftaran mendarat di sini tanpa akses kakitangan — naik taraf oleh super admin sahaja."
                )}
          </p>
          <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
            {customerRows.length === 0 && (
              <p className="text-muted-foreground px-3 py-2 text-sm">
                {L("No customer accounts yet.", "Tiada akaun pelanggan lagi.")}
              </p>
            )}
            {customerRows.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {properName(u.full_name || u.name)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {u.email}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {!u.is_active && (
                    <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">
                      {L("disabled", "dinyahaktif")}
                    </span>
                  )}
                  {canEdit && editId !== u.id && (
                    <button
                      type="button"
                      className="text-[11px] underline"
                      onClick={() => {
                        setEditId(u.id);
                        setDraft({
                          role: "live_host",
                          employment_status: "part_time",
                        });
                      }}
                    >
                      ✎ {L("Promote", "Naik taraf")}
                    </button>
                  )}
                </span>
                {editId === u.id && roleEditor(u)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <p className="text-sm font-semibold">
          {L(
            "User log — recent sign-ins & account events",
            "Log pengguna — log masuk & peristiwa akaun terkini"
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit lives in /admin.",
            "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA. Audit penuh berada di /admin."
          )}
        </p>
        <div className="mt-2 max-h-56 space-y-0 overflow-y-auto pr-1">
          {events.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}
            </p>
          )}
          {events.map((e, i) => (
            <div
              key={i}
              className="border-border flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b py-1 text-[11px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{properName(e.name ?? "")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {e.email ?? ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] ${e.action.includes("2fa_enabled") ? "bg-green-100 text-green-700" : e.action.includes("2fa") ? "bg-blue-100 text-blue-800" : e.action.includes("password") ? "bg-amber-100 text-amber-800" : "bg-secondary"}`}
                >
                  {e.action.replace("auth.", "").replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">
                  {mytStamp2(e.created_at)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= v1.6.0 — Leaderboard + targets/commission ================ */

const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "cco"];

interface LeaderRow {
  user_id: number;
  name: string;
  role: string;
  photo_key: string | null;
  sales_cents: number;
  target_cents: number | null;
  pct: number | null;
  commission_cents: number;
  rank: number | null;
}

/** The sales leaderboard — attributed sales per person this month, progress to
    target, and the commission the active rules would pay. The motivational
    heart of the sales floor. */
function LeaderboardCard({ user }: { user: User }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [hasRules, setHasRules] = useState(false);
  const canSeeCommission = TARGET_ADMIN_ROLES.includes(user.role);
  useEffect(() => {
    void api<{ rows: LeaderRow[]; has_rules: boolean }>(
      `/staff/leaderboard`
    ).then((r) => {
      if (r.ok && r.data) {
        setRows(r.data.rows);
        setHasRules(r.data.has_rules);
      } else setRows([]);
    });
  }, []);
  /* v1.25.5: unknown until proven empty — a skeleton while the board loads,
     never a blank hole where the card should be. */
  if (!rows) {
    return (
      <div className={card}>
        <Skel className="h-4 w-56" />
        <Skel className="mt-1.5 h-3 w-full max-w-md" />
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5">
              <Skel className="h-6 w-6 rounded-full" />
              <Skel className="h-3.5 flex-1" />
              <Skel className="hidden h-2 w-28 sm:block" />
              <Skel className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  /* v1.25.5: no emoji in the UI — ranks are a gold badge for the podium and a
     plain #n below it. An unranked line (no attributed sales yet) shows a
     dash: the person is on the board, they just have not sold this month. */
  const rankBadge = (rank: number | null) => {
    if (rank === null)
      return (
        <span className="text-muted-foreground w-7 shrink-0 text-center text-xs">
          —
        </span>
      );
    if (rank <= 3) {
      const tone =
        rank === 1
          ? "bg-gold-solid text-white"
          : rank === 2
            ? "bg-gold-soft text-gold-deep"
            : "bg-secondary text-gold-deep";
      return (
        <span className="flex w-7 shrink-0 justify-center">
          <span
            className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold tabular-nums ${tone}`}
          >
            {rank}
          </span>
        </span>
      );
    }
    return (
      <span className="text-muted-foreground w-7 shrink-0 text-center text-xs tabular-nums">
        #{rank}
      </span>
    );
  };
  const top = rows[0]?.sales_cents ?? 0;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        {L(
          "Sales leaderboard — this month",
          "Papan pendahulu jualan — bulan ini"
        )}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Attributed sales per person: paid invoices they closed, TikTok GMV during their live sessions, walk-in sales they recorded — and for sales marketing, TikTok orders that land while they are clocked in (split when several are on shift). Sales, live and CCO are always listed, even at RM 0.00.",
          "Jualan yang dikaitkan bagi setiap orang: invois dibayar yang mereka tutup, GMV TikTok semasa sesi LIVE mereka, jualan walk-in yang mereka rekodkan — dan bagi sales marketing, pesanan TikTok yang masuk semasa mereka daftar masuk (dibahagi apabila beberapa orang bertugas). Jualan, LIVE dan CCO sentiasa disenaraikan, walaupun RM 0.00."
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {L(
            "No sales staff on the board yet — assign a sales or live-host role and the board fills as orders land and lives run.",
            "Belum ada kakitangan jualan di papan — tetapkan peranan jualan atau hos LIVE dan papan akan terisi apabila pesanan masuk dan LIVE berjalan."
          )}
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const isMe = r.user_id === user.id;
            return (
              <div
                key={r.user_id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${isMe ? "bg-gold-soft/50 ring-gold ring-1" : r.rank !== null && r.rank <= 3 ? "bg-secondary/60" : ""}`}
              >
                {rankBadge(r.rank)}
                <span className="min-w-0 flex-1 truncate">
                  <span
                    className={`font-medium ${r.rank === null ? "text-muted-foreground" : ""}`}
                  >
                    {r.name}
                  </span>
                  {isMe && (
                    <span className="text-gold-deep ml-1 text-[11px] font-semibold">
                      {L("you", "anda")}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-1.5 text-[11px] capitalize">
                    {r.role.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="hidden w-28 shrink-0 sm:block">
                  <MiniBar
                    pct={top > 0 ? (r.sales_cents / top) * 100 : 0}
                    tone={r.rank === 1 ? "green" : "gold"}
                  />
                </span>
                <span
                  className={`w-24 shrink-0 text-right font-semibold tabular-nums ${r.rank === null ? "text-muted-foreground font-normal" : ""}`}
                >
                  {fmtRM(r.sales_cents)}
                </span>
                {r.pct !== null && (
                  <span
                    className={`hidden w-12 shrink-0 text-right text-xs tabular-nums sm:block ${r.pct >= 100 ? "text-bull font-semibold" : "text-muted-foreground"}`}
                  >
                    {r.pct}%
                  </span>
                )}
                {canSeeCommission && r.commission_cents > 0 && (
                  <span
                    className="text-gold-deep w-20 shrink-0 text-right text-xs tabular-nums"
                    title={L(
                      "commission the active rules would pay",
                      "komisen yang akan dibayar oleh peraturan aktif"
                    )}
                  >
                    +{fmtRM(r.commission_cents)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canSeeCommission && !hasRules && rows.length > 0 && (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {L(
            "Add a commission rule below to show each person's payout here.",
            "Tambah peraturan komisen di bawah untuk memaparkan bayaran setiap orang di sini."
          )}
        </p>
      )}
    </div>
  );
}

interface CommRule {
  id: number;
  name: string;
  base_pct: number;
  bonus_pct: number;
  applies_to: string;
  active: number;
}

/** Management: per-person & per-team targets, and commission rules. */
function TargetsCommissionCard() {
  const month = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 7);
  const [staff, setStaff] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const [userTargets, setUserTargets] = useState<Record<number, number>>({});
  const [teamTargets, setTeamTargets] = useState<Record<string, number>>({});
  const [rules, setRules] = useState<CommRule[] | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    base_pct: "",
    bonus_pct: "",
    applies_to: "all",
  });
  const { show: showToast, node: toastNode } = useSaveToast();

  const loadTargets = useCallback(() => {
    void api<{
      staff: { id: number; name: string; role: string }[];
      user_targets: { user_id: number; target_cents: number }[];
      team_targets: { team: string; target_cents: number }[];
    }>(`/staff/targets?month=${month}`).then((r) => {
      if (r.ok && r.data) {
        setStaff(r.data.staff);
        setUserTargets(
          Object.fromEntries(
            r.data.user_targets.map((t) => [t.user_id, t.target_cents])
          )
        );
        setTeamTargets(
          Object.fromEntries(
            r.data.team_targets.map((t) => [t.team, t.target_cents])
          )
        );
      }
    });
  }, [month]);
  const loadRules = useCallback(() => {
    void api<{ rules: CommRule[] }>(`/staff/commission/rules`).then((r) => {
      if (r.ok && r.data) setRules(r.data.rules);
    });
  }, []);
  useEffect(() => {
    loadTargets();
    loadRules();
  }, [loadTargets, loadRules]);

  const saveTarget = async (
    scope: "user" | "team",
    id: number | string,
    rm: string
  ) => {
    const cents = Math.round(Number(rm) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      showToast(
        L("No change", "Tiada perubahan"),
        L("Enter an amount first", "Masukkan amaun dahulu"),
        "notice"
      );
      return;
    }
    const res = await api(`/staff/targets`, {
      method: "POST",
      body: JSON.stringify({ scope, id, month, target_cents: cents }),
    });
    if (res.ok) {
      showToast(
        L("Saved", "Disimpan"),
        L(
          `Target set for ${ym(month)}`,
          `Sasaran ditetapkan untuk ${ym(month)}`
        )
      );
      loadTargets();
    }
  };

  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">
        {L("Targets & commission", "Sasaran & komisen")} — {ym(month)}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Set each person's and each team's monthly goal, and the commission rules that pay them. Feeds the leaderboard and the dashboard.",
          "Tetapkan matlamat bulanan setiap orang dan setiap pasukan, serta peraturan komisen yang membayar mereka. Menyalur ke papan pendahulu dan papan pemuka."
        )}
      </p>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Per-person targets (RM)", "Sasaran individu (RM)")}
        </p>
        {/* v1.21.1 (CEO: "should not so much row like this"): a labelled
            grid — the whole floor fits in two or three short rows instead
            of one full-width input per person. */}
        <div className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {staff.map((s) => (
            <label key={s.id} className="block min-w-0">
              <span
                className="text-muted-foreground mb-0.5 block truncate text-[11px] font-medium"
                title={s.name}
              >
                {properName(s.name)}{" "}
                <span className="capitalize">
                  · {s.role.replace(/_/g, " ")}
                </span>
              </span>
              <input
                type="number"
                min={0}
                step="100"
                className={`${inputClass} h-8 text-xs`}
                defaultValue={
                  userTargets[s.id] != null
                    ? (userTargets[s.id]! / 100).toString()
                    : ""
                }
                placeholder={L("e.g. 8000", "cth. 8000")}
                onBlur={(e) => {
                  if (e.target.value)
                    void saveTarget("user", s.id, e.target.value);
                }}
              />
            </label>
          ))}
          {staff.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {L(
                "No staff to target yet.",
                "Belum ada kakitangan untuk disasarkan."
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Team targets (RM)", "Sasaran pasukan (RM)")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {["sales", "live"].map((team) => (
            <label key={team} className="flex items-center gap-2 text-sm">
              <span className="capitalize">
                {team === "sales" ? L("sales", "jualan") : team}
              </span>
              <input
                type="number"
                min={0}
                step="100"
                className={`${inputClass} h-8 w-32 text-xs`}
                defaultValue={
                  teamTargets[team] != null
                    ? (teamTargets[team]! / 100).toString()
                    : ""
                }
                placeholder={L("team goal", "sasaran pasukan")}
                onBlur={(e) => {
                  if (e.target.value)
                    void saveTarget("team", team, e.target.value);
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Commission rules", "Peraturan komisen")}
        </p>
        <div className="mt-1.5 space-y-1">
          {(rules ?? []).map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground ml-1.5 text-xs">
                  {L(`${r.base_pct}% base`, `${r.base_pct}% asas`)}
                  {r.bonus_pct
                    ? L(
                        ` + ${r.bonus_pct}% over target`,
                        ` + ${r.bonus_pct}% melebihi sasaran`
                      )
                    : ""}{" "}
                  ·{" "}
                  {r.applies_to === "all"
                    ? L("everyone", "semua")
                    : r.applies_to.replace(/_/g, " ")}
                </span>
              </span>
              <button
                type="button"
                className={btnSm}
                onClick={async () => {
                  await api(`/staff/commission/rules/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: r.active ? 0 : 1 }),
                  });
                  loadRules();
                }}
              >
                {r.active ? L("On", "Hidup") : L("Off", "Mati")}
              </button>
              <button
                type="button"
                className={`${btnSm} text-destructive`}
                onClick={async () => {
                  await api(`/staff/commission/rules/${r.id}`, {
                    method: "DELETE",
                  });
                  loadRules();
                }}
              >
                {L("Remove", "Buang")}
              </button>
            </div>
          ))}
          {rules && rules.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {L(
                "No rules yet — add one below (e.g. 1.5% base + 3% over target).",
                "Tiada peraturan lagi — tambah satu di bawah (cth. 1.5% asas + 3% melebihi sasaran)."
              )}
            </p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input
            className={`${inputClass} h-8 w-40 text-xs`}
            placeholder={L("Rule name", "Nama peraturan")}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label className="text-xs">
            {L("base %", "% asas")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={`${inputClass} ml-1 h-8 w-16 text-xs`}
              value={draft.base_pct}
              onChange={(e) => setDraft({ ...draft, base_pct: e.target.value })}
            />
          </label>
          <label className="text-xs">
            {L("bonus %", "% bonus")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={`${inputClass} ml-1 h-8 w-16 text-xs`}
              value={draft.bonus_pct}
              onChange={(e) =>
                setDraft({ ...draft, bonus_pct: e.target.value })
              }
            />
          </label>
          <button
            type="button"
            className={btnSmPrimary}
            disabled={!draft.name || !draft.base_pct}
            onClick={async () => {
              const res = await api(`/staff/commission/rules`, {
                method: "POST",
                body: JSON.stringify({
                  name: draft.name,
                  base_pct: Number(draft.base_pct),
                  bonus_pct: Number(draft.bonus_pct || 0),
                  applies_to: draft.applies_to,
                }),
              });
              if (res.ok) {
                setDraft({
                  name: "",
                  base_pct: "",
                  bonus_pct: "",
                  applies_to: "all",
                });
                showToast(
                  L("Saved", "Disimpan"),
                  L("Commission rule added", "Peraturan komisen ditambah")
                );
                loadRules();
              }
            }}
          >
            {L("Add rule", "Tambah peraturan")}
          </button>
        </div>
      </div>
    </div>
  );
}

// v1.4.101: order set by the CEO — Dashboard > News > HR > Staff Details >
// Attendance > Leave > (Tasks kept for task-only roles) > Claims > Payroll >
// Expenses > Sales > Inventory > Birthdays > Profile > Users
// (v1.4.143: CEO's revised order — Overview right after Dashboard).
/* v1.19.0 (consolidation C1, CEO-approved): 28 tabs -> 22. Orders retired
   (sales_documents is the one recorder); Overview folded into Dashboard/
   Tasks/Inventory; Birthdays folded into Staff Details; Cash Flow merged
   into the renamed Finance tab. Tables were NOT dropped. */
/* v1.22.0 (CEO: "I want organized for my staff able to access their tabs
   easily and correctly"): tab order = HIS list, verbatim. Order matters
   beyond cosmetics — the phone bottom bar is the first FOUR tabs each role
   can see, so this sequencing decides every role's thumb row: management
   leads with Attendance/Ecommerce/Inventory, while a live host's first
   four resolve to Dashboard/Attendance/News/Leave — their actual day. */
const ALL_TABS = [
  "Dashboard",
  "Attendance",
  "Ecommerce",
  "Inventory",
  "Web Orders",
  "Sales",
  "Announcements",
  "HR",
  "Staff Details",
  "Leave",
  "Claims",
  "Payroll",
  "Finance",
  "Tasks",
  "Content",
  "Reconciliation",
  "Commission",
  "Ads Fund",
  "Purchasing",
  "Accounting",
  "Stokis",
  "Assets",
  "Profile",
  "Users",
] as const;
// v1.4.111: one label mapping for EVERY nav renderer (desktop pills leaked
// the raw "Announcements" key — spotted on the CEO's screenshot).
// const tabLabel = (t: string) => t === "Announcements" ? "News" : t === "Staff Details" ? "Staff" : t;

/** Which roles see each role-specific tab. The API enforces the same matrix. */
// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];

const TAB_ROLES: Partial<Record<(typeof ALL_TABS)[number], readonly string[]>> =
  {
    // HR pipeline: docs (QT/DO/INV), leave, attendance + payroll CSV.
    HR: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
    Payroll: ["ceo", "coo", "super_admin", "admin"],
    // Expense claims (v1.4.75): CEO/COO/CCO/HR submit; the CEO decides.
    Claims: [
      "ceo",
      "coo",
      "cco",
      "hr_admin",
      "sales_marketing",
      "editor",
      "marketing",
      "live_host",
      "super_admin",
      "admin",
    ], // v1.4.106: every staff role claims
    // Company expenses (v1.4.87): CEO and COO per spec.
    Finance: ["ceo", "coo", "super_admin", "admin"],
    // Inventory & tracking: sales_marketing only among staff (editor/marketing
    // and everyone else are excluded).
    Inventory: [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "sales_marketing",
      "marketing",
      "hr_admin",
    ],
    // Read-only company monitor. CEO + COO + CCO + admin tier.
    // Employee records: IDs, position, department, staff list, birth dates.
    "Staff Details": ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
    // v1.4.213: asset register — same tier as Staff Details (HR keeps it).
    Assets: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
    Users: ["super_admin", "admin", "ceo", "coo"], // v1.40.0 (AUDIT M14): the server already allowed admin
    /* v1.18.0 — ERP modules. These mirror worker/src/permissions.ts; the
     worker matrix is the one actually enforced. */
    /* v1.22.0 (CEO: "without anyone populate or access tabs that not
     authorize for them"): Ecommerce was open to EVERY staff role — the
     one loose default left. Editors and live hosts are out; the tab is
     the revenue/orders view, and its data routes were already gated to
     this tier server-side. */
    Ecommerce: [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "hr_admin",
      "sales_marketing",
      "marketing",
    ],
    /* v1.37.0: ELFIA web orders — the sales/inventory tier plus executives.
     Mirrors the /staff/web-orders permission check (sales|inventory|exec). */
    "Web Orders": [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "hr_admin",
      "sales_marketing",
      "marketing",
    ],
    Reconciliation: ["super_admin", "admin", "ceo", "coo", "sales_marketing"],
    Commission: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"],
    "Ads Fund": [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "sales_marketing",
      "marketing",
    ],
    Purchasing: ["super_admin", "admin", "ceo", "coo"],
    Accounting: ["super_admin", "admin", "ceo"],
    // v1.7.0: Content is open to the team that makes it; Stokis to the
    // sales/management tier. (v1.21.0: Pipeline retired.)
    Content: [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "hr_admin",
      "sales_marketing",
      "marketing",
      "editor",
      "live_host",
    ],
    Stokis: [
      "super_admin",
      "admin",
      "ceo",
      "coo",
      "cco",
      "hr_admin",
      "sales_marketing",
      "marketing",
    ],
  };
type TabName = (typeof ALL_TABS)[number];

export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  /* v1.4.231 (CEO: "when I refresh the tabs back to Dashboard instead of
     last tab that I open"): the active tab was plain useState — a refresh
     rebuilds the page and lands on the default. Now the last tab persists
     per device (localStorage azone-tab), restored on load and validated:
     if the saved tab isn't visible to this account (role change, 🔐 tab
     access change), the guard effect below falls back to Dashboard. */
  const [tab, setTab] = useState<TabName>("Dashboard");
  /* v1.4.232 (CEO: "does it will accidentally appear the full tabs roles by
     accidents?"): his question exposed a shared-device edge in v1.4.231 —
     the remembered tab was stored per DEVICE, so a lower-role account
     signing in after the CEO could restore a restricted tab for one render
     frame (the server 403s all data, but even a panel skeleton must not
     flash). Two fixes: the key is per USER (azone-tab:{id} — accounts never
     inherit each other's tab), and the render below clamps through
     activeTab so an out-of-scope tab can never mount, not even one frame. */
  /* v1.24.0 (CEO refined v1.23.6: "if they refresh it will remain to the
     last page that they visit… go back to dashboard if the staff close
     their web/mobile browser"): tab memory lives in SESSION STORAGE now —
     the browser feature with exactly those semantics. A refresh keeps the
     tab; closing the tab/browser clears it, so the next open starts at the
     Dashboard. Per-user key + the activeTab clamp keep the v1.4.232
     shared-device guarantee (no restricted tab can mount for a lower role),
     and a crashed tab can only haunt one browser session, never every
     visit (v1.22.7). Old localStorage keys from the retired scheme are
     cleaned up. */
  useEffect(() => {
    try {
      if (!user) return;
      window.localStorage.removeItem(`azone-tab:${user.id}`); // retired v1.4.231 scheme
      const saved = window.sessionStorage.getItem(`azone-tab:${user.id}`);
      if (saved && (ALL_TABS as readonly string[]).includes(saved))
        setTab(saved as TabName);
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    try {
      if (user) window.sessionStorage.setItem(`azone-tab:${user.id}`, tab);
    } catch {
      /* private mode */
    }
  }, [tab, user?.id]);
  const [dark, setDark] = useState(false);
  // v1.9.0: Plum & Rose theme preset + EN/BM chrome language (per device)
  const [theme, setTheme] = useState<"navy" | "plum">("navy");
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    setTheme(
      localStorage.getItem("azone-theme-preset") === "plum" ? "plum" : "navy"
    );
    setLangState(getLang());
  }, []);
  useEffect(() => {
    if (theme === "plum")
      document.documentElement.setAttribute("data-theme", "plum");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("azone-theme-preset", theme);
  }, [theme]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  /* v1.4.219: CEO-managed tab access overrides (system_meta). */
  const [tabOverrides, setTabOverrides] = useState<Record<string, string[]>>(
    {}
  );
  useEffect(() => {
    void fetch("/api/v1/staff/tabs/access", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((d) => {
        if (d && typeof d === "object" && "overrides" in d)
          setTabOverrides(
            (d as { overrides: Record<string, string[]> }).overrides ?? {}
          );
      })
      .catch(() => {
        /* old worker: defaults apply */
      });
  }, []);
  const [showNotifs, setShowNotifs] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // v1.8.0: global search (Ctrl/Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || (e as unknown as { metaKey?: boolean }).metaKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () =>
      window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, []);

  // While the More sheet is open, the page behind must not scroll — the
  // sheet then behaves like a native menu instead of a floating layer.
  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  useEffect(() => {
    setDark(localStorage.getItem("azone-theme") === "dark");
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) {
        setUser(r.data.user);
        // v1.25.0: remembered data is per-account — switching users wipes it.
        setCacheScope(r.data.user.id);
      } else setCacheScope(null);
      setChecked(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("azone-theme", dark ? "dark" : "light");
  }, [dark]);

  // v1.4.144: notification chime — a soft two-tone ding synthesized with the
  // Web Audio API (no file to download), played when NEW unread notifications
  // arrive. Browsers only allow audio after a user gesture, so the first
  // click/tap anywhere unlocks the audio context; polls before that stay
  // silent (the badge still updates). Toggleable via the 🔔/🔕 button.
  const [sound, setSound] = useState(true);
  // v1.6.0: web-push permission state for this device.
  const [pushState, setPushState] = useState<
    "default" | "granted" | "denied" | "unsupported"
  >("default");
  useEffect(() => {
    setSound(localStorage.getItem("azone-notif-sound") !== "off");
    setPushState(pushPermission());
  }, []);
  const audioRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef<number | null>(null); // null = first load (no chime)
  // v1.6.0: the SSE stream reads the latest list without re-subscribing.
  const notifsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notifsRef.current = notifs;
  }, [notifs]);
  useEffect(() => {
    // Unlock on the first gesture so POLL-triggered chimes are allowed later.
    const unlock = () => {
      if (!audioRef.current) {
        try {
          const AC =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (AC) audioRef.current = new AC();
        } catch {
          /* very old browser — chime simply stays off */
        }
      }
      void audioRef.current?.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  const chime = useCallback(async () => {
    // v1.4.151 FIX: the first 🔊 press raced the unlock — resume() is async,
    // so ctx.state was still "suspended" when the click handler chimed, and
    // the guard swallowed the sound. Now the chime itself creates the context
    // if needed and AWAITS resume before checking. Called from a gesture
    // (the toggle) this always resumes; called from a background poll it
    // resumes only if a gesture already unlocked audio — same policy, no race.
    let ctx = audioRef.current;
    if (!ctx) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AC) {
          ctx = new AC();
          audioRef.current = ctx;
        }
      } catch {
        return;
      }
    }
    if (!ctx) return;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    if (ctx.state !== "running") return;
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + at);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + at + 0.45
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.5);
    };
    note(880, 0); // A5
    note(1174.66, 0.12); // D6 — rising two-tone, short and unobtrusive
  }, []);

  useEffect(() => {
    if (!user) return;
    // v1.6.0: chime + badge logic factored out so both the initial fetch, the
    // safety-net poll, and the live SSE stream feed it.
    const applyList = (list: Notification[]) => {
      const nowUnread = list.filter((n) => !n.is_read).length;
      if (
        unreadRef.current !== null &&
        nowUnread > unreadRef.current &&
        localStorage.getItem("azone-notif-sound") !== "off"
      ) {
        void chime();
      }
      unreadRef.current = nowUnread;
      setNotifs(list);
    };
    const fetchNotifs = () =>
      void api<{ notifications: Notification[] }>("/staff/notifications").then(
        (r) => {
          if (r.data?.notifications) applyList(r.data.notifications);
        }
      );
    fetchNotifs();

    /* v1.6.0 REAL-TIME: an SSE stream delivers new notifications within
       ~5 seconds instead of up to 60. The Worker stream self-closes after
       ~20s and EventSource reconnects automatically. A slow 120s poll stays
       as a safety net (and covers browsers where SSE is blocked). The chime
       still fires on the same increase rule; server-side web-push covers the
       tab-closed case. */
    let es: EventSource | null = null;
    let sinceId = 0;
    const openStream = () => {
      try {
        sinceId = Math.max(sinceId, ...notifsRef.current.map((n) => n.id), 0);
        es = new EventSource(
          `/api/v1/staff/notifications/stream?since=${sinceId}`,
          { withCredentials: true }
        );
        es.addEventListener("notifications", (ev) => {
          try {
            const incoming = JSON.parse(
              (ev as MessageEvent).data
            ) as Notification[];
            if (!incoming.length) return;
            const merged = [...incoming.reverse(), ...notifsRef.current]
              .filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i)
              .sort((a, b) => b.id - a.id)
              .slice(0, 50);
            sinceId = Math.max(sinceId, ...incoming.map((n) => n.id));
            applyList(merged);
          } catch {
            /* ignore malformed frame */
          }
        });
        es.onerror = () => {
          es?.close();
          es = null;
        };
      } catch {
        /* EventSource unsupported — the poll below carries it */
      }
    };
    openStream();
    const reconnect = window.setInterval(() => {
      if (!es) openStream();
    }, 8000);
    const timer = window.setInterval(fetchNotifs, 120_000);
    window.addEventListener("focus", fetchNotifs);
    return () => {
      es?.close();
      window.clearInterval(reconnect);
      window.clearInterval(timer);
      window.removeEventListener("focus", fetchNotifs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chime]);

  const unread = notifs.filter((n) => !n.is_read).length;
  /* v1.4.219 (CEO tab access control): server-side overrides from the 🔐
     card on the Users tab. Absent tab = the built-in default below.
     Rails: Dashboard + Profile always visible; super_admin ignores
     overrides entirely (the escape hatch); fetch failure (old worker) =
     defaults, so a split deploy can never blank the tab strip. */
  const tabs = ALL_TABS.filter((t) => {
    if (!user) return true;
    if (t === "Dashboard" || t === "Profile") return true;
    if (user.role === "super_admin") return true;
    const ov = tabOverrides[t];
    if (ov !== undefined) return ov.includes(user.role);
    if (t === "Sales")
      return SALES_ROLES.includes(user.role) || user.role === "ceo";
    const allowed = TAB_ROLES[t];
    return !allowed || allowed.includes(user.role);
  });
  // v1.4.231 guard: a remembered tab this account can't see → Dashboard.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("Dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join("|"), tab]);

  /* v1.21.1: the shell scrolls INTERNALLY now (#shell-scroll in AppShell),
     so a tab switch must rewind that container — without this, opening a
     tab landed wherever the previous tab was scrolled to. (Lives BEFORE the
     early returns below — hooks must run on every render.) */
  useEffect(() => {
    document.getElementById("shell-scroll")?.scrollTo({ top: 0 });
  }, [tab]);

  /* v1.23.8 — overflow self-report (CEO's phone shows a clipped roster no
     sandbox engine reproduces): 2s after each tab renders on a PHONE, the
     page measures itself; anything poking past the screen edge is reported
     to the error_log (source: ui_overflow) with the exact element — once
     per tab per session per build. The shell's own clip guard is skipped
     when checking containment, so it can't hide the culprit. Diagnostics
     must never break the page: everything is try-wrapped. */
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const t = window.setTimeout(() => {
      try {
        const vw = document.documentElement.clientWidth;
        const dw = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        );
        const bad: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          if (bad.length >= 5) return;
          const h = el as HTMLElement;
          const r = h.getBoundingClientRect();
          if (r.width <= 0 || r.right <= vw + 1) return;
          const cs = getComputedStyle(h);
          if (cs.display === "none" || cs.position === "fixed") return;
          let a = h.parentElement;
          let contained = false;
          /* body/html/#shell-scroll do NOT count as containers: body's own
             overflow-x rule is exactly what iOS Safari ignores (the reason
             phones pan while every desktop engine looks clean), and the
             shell clip is our guard, not the culprit's alibi. */
          while (a && a !== document.body && a !== document.documentElement) {
            if (
              a.id !== "shell-scroll" &&
              /(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)
            ) {
              contained = true;
              break;
            }
            a = a.parentElement;
          }
          if (!contained)
            bad.push(
              `${h.tagName}.${String(h.className).slice(0, 90)}|R${Math.round(r.right)}`
            );
        });
        if (bad.length > 0 || dw > vw + 1) {
          const key = `azone-ovf:${APP_VERSION}:${tab}`;
          if (!window.sessionStorage.getItem(key)) {
            window.sessionStorage.setItem(key, "1");
            void api(`/staff/debug/overflow`, {
              method: "POST",
              body: JSON.stringify({ tab, v: APP_VERSION, vw, dw, els: bad }),
            });
          }
        }
      } catch {
        /* never break the page for a diagnostic */
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, [tab]);

  /* v1.25.0 (CEO: "a dead skeleton waiting for my website like a Threads
     so that my staff wont see any loading"): this used to be `return null`
     — and because the site is a static export, THAT NULL WAS THE HTML FILE.
     Staff saw a white screen through the whole JS download and the auth
     round-trip. The skeleton below ships inside portal.html and paints
     immediately, with zero JavaScript. */
  if (!checked) return <PortalSkeleton />;
  if (user?.role === "customer") {
    if (typeof window !== "undefined") window.location.replace("/account");
    return null;
  }
  // Content-team roles work in /admin; if one lands here, send them home.
  // (Admins are allowed to use portal modules via the admin Staff bridge, but
  // their front door is /admin — this keeps each role's default flow clean.)
  if (user && CONTENT_ONLY_ROLES.includes(user.role)) {
    if (typeof window !== "undefined") window.location.replace("/admin");
    return null;
  }
  if (!user) {
    return (
      <div className="mx-auto mt-24 max-w-sm px-6 text-center">
        <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">
          {L(
            "A2Z CREATIVE MARKETING / Staff Portal",
            "A2Z CREATIVE MARKETING / Portal Kakitangan"
          )}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {L("Sign in required", "Log masuk diperlukan")}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {L(
            "The Staff Portal is for A2Z CREATIVE MARKETING employees only.",
            "Portal Kakitangan hanya untuk pekerja A2Z CREATIVE MARKETING."
          )}
        </p>
        <a href="/login" className={`${btnClass} mt-6`}>
          {L("Go to login", "Pergi ke log masuk")}
        </a>
      </div>
    );
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className="border-border bg-card rounded-xl border p-6 shadow-sm">
          <h1 className="text-foreground mb-2 text-2xl font-semibold tracking-tight">
            {L(
              "Two-Factor Authentication Required",
              "Pengesahan Dua Faktor Diperlukan"
            )}
          </h1>
          <p className="text-muted-foreground mb-8 text-sm">
            {L(
              "Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Staff Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Kakitangan A2Z CREATIVE MARKETING. Sila sediakannya sekarang."
            )}
          </p>
          <TwoFactorPanel />
          <div className="border-border mt-8 flex justify-end border-t pt-6">
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button looped users back to
                   the same screen forever. A real server-side logout now. */
                void api("/auth/logout", {
                  method: "POST",
                  body: JSON.stringify({}),
                }).then(() => {
                  window.location.href = "/login";
                });
              }}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {L("Sign out", "Log keluar")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  /* v1.4.232: render-time clamp — effects run AFTER a render, so the guard
     alone still allowed one frame; every panel below renders off activeTab,
     which can never name a tab outside this account's visible list. */
  const activeTab: TabName = tabs.includes(tab) ? tab : "Dashboard";

  const navItems = tabs.map((tb) => ({ name: tb, label: tr(tb, lang) }));
  return (
    /* v1.13.0: AppShell now renders the grouped ERP sidebar (CEO's DZI
       reference). It receives the SAME `navItems` the role gating and
       tab-access overrides already produced — the shell groups them for
       display and decides nothing about visibility. Below `md` it renders
       `children` unstyled, so the v1.11.1 phone is untouched. */
    <AppShell
      rail={
        <SidebarNav
          items={navItems}
          active={activeTab}
          onSelect={(t) => setTab(t as TabName)}
          onSignOut={() =>
            void api("/auth/logout", {
              method: "POST",
              body: JSON.stringify({}),
            }).then(() => {
              clearApiCache();
              setUser(null);
            })
          }
        />
      }
      /* v1.14.0: the side columns carry a date context.
         v1.17.0 (CEO: "Schedule & Roster seem take so much unrelated things
         there"): DASHBOARD ONLY. On Attendance the rails repeated pending
         leave / open tasks / announcements beside a tab that is already five
         cards deep — duplication read as clutter, and the roster lost width
         to it. Work tabs get the full working area. */
      contextPanel={
        activeTab === "Dashboard" ? <ContextPanel lang={lang} /> : undefined
      }
      rightRail={
        activeTab === "Dashboard" ? <RightRail lang={lang} /> : undefined
      }
    >
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={navItems}
        canSeeClients={REVENUE_ROLES.includes(user.role)}
        onTab={(t) => setTab(t as TabName)}
        extraActions={[
          {
            label: tr("Apply leave", lang),
            hint: L("action", "tindakan"),
            run: () => {
              setTab("Leave");
              setPaletteOpen(false);
            },
          },
          ...(SALES_ROLES.includes(user.role)
            ? [
                {
                  label: tr("Create quotation", lang),
                  hint: L("action", "tindakan"),
                  run: () => {
                    setTab("Sales");
                    setPaletteOpen(false);
                  },
                },
              ]
            : []),
          {
            label: L("Toggle dark mode", "Tukar mod gelap"),
            hint: L("action", "tindakan"),
            run: () => {
              setDark((v) => !v);
              setPaletteOpen(false);
            },
          },
        ]}
      />
      {/* v1.10.0: pb-28 — the bottom nav grew to min-h-16 + safe-area inset,
        pb-24 left the last card's edge underneath it on notched phones. */}
      <div className="w-full px-4 py-3 pb-28 md:mx-0 md:max-w-none md:px-5 md:py-4 md:pb-6">
        {/* v1.13.0: on desktop this row IS the shell's topbar. `md:-mx-5 md:-mt-4`
          breaks it out of <main>'s padding so it spans the full working area,
          and it stays sticky/bordered instead of dissolving into the page as
          it did before. Every mobile class is unchanged. */}
        <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur md:-mx-5 md:mb-4 md:gap-3 md:px-5 md:py-3 md:backdrop-blur-none">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            {/* v1.4.141: the badge-card photo as an app-style avatar — circular,
              gold-ringed, next to the welcome on desktop and the screen title
              on mobile. Falls back to the initial when no photo is set. */}
            {user.photo_key ? (
              <img
                src={`/api/v1/media/file/${encodeURIComponent(user.photo_key)}`}
                alt=""
                className="ring-gold h-9 w-9 shrink-0 rounded-full object-cover ring-2 md:h-11 md:w-11"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className="bg-primary text-primary-foreground ring-gold flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 md:h-11 md:w-11">
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
                {tr("Staff Portal short", lang)}
              </p>
              {/* v1.15.0: time-of-day greeting, as the reference.
                v1.16.0: text-lg until 2xl — xl is 1280px, so at a 1440px
                viewport (both side columns open, 773px header) xl:text-xl
                re-applied the 20px size and the name clipped by 12px. 2xl
                (1536px) is the first width with room for it. Measured, not
                guessed: h1 183px available vs 195px scrollWidth at text-xl. */}
              <h1 className="hidden truncate text-lg font-semibold tracking-tight md:block 2xl:text-xl">
                {mytGreeting(lang)}, {user.name.split(" ")[0]}
              </h1>
              {/* On phones the header reads like an app screen title.
                v1.10.0: the Dashboard says "Today" (the reference design's
                home title); every other tab keeps its own name. */}
              <h1 className="truncate text-xl font-bold tracking-tight md:hidden">
                {activeTab === "Dashboard"
                  ? tr("Today", lang)
                  : tr(activeTab, lang)}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 md:min-w-0 md:shrink">
            {/* v1.8.0: global search — opens the palette (Ctrl/Cmd+K works anywhere) */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="border-border text-muted-foreground hover:bg-secondary hidden h-9 w-40 min-w-24 shrink items-center justify-between rounded-lg border px-3 text-sm transition-colors md:flex"
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <span className="flex items-center gap-2">
                <Search aria-hidden className="h-4 w-4" strokeWidth={1.75} />{" "}
                {tr("Search…", lang)}
              </span>
              <kbd className="bg-secondary rounded px-1.5 py-0.5 text-[10px] font-medium">
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              className={`${btnHdr} md:hidden`}
              onClick={() => setPaletteOpen(true)}
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <Search aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {/* v1.10.0: sound, push and EN/BM are set-once switches, not daily
              taps — on phones they live in the More sheet's Preferences row
              so the app bar keeps just search · bell · dark · sign out. */}
            <button
              type="button"
              className={btnHdrDesktop}
              title={
                sound
                  ? L(
                      "Notification sound ON — tap to mute",
                      "Bunyi pemberitahuan HIDUP — tekan untuk senyapkan"
                    )
                  : L(
                      "Notification sound OFF — tap to unmute",
                      "Bunyi pemberitahuan MATI — tekan untuk hidupkan"
                    )
              }
              aria-label={
                sound
                  ? L(
                      "Mute notification sound",
                      "Senyapkan bunyi pemberitahuan"
                    )
                  : L(
                      "Unmute notification sound",
                      "Hidupkan bunyi pemberitahuan"
                    )
              }
              onClick={() => {
                const next = !sound;
                setSound(next);
                localStorage.setItem("azone-notif-sound", next ? "on" : "off");
                if (next) void chime(); // audible confirmation (gesture context — always plays now)
              }}
            >
              {sound ? (
                <Volume2 aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <VolumeX aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
            {/* v1.6.0: push alerts to this device (works even with the tab
              closed). Hidden where the browser can't do web push. */}
            {pushState !== "unsupported" && (
              <button
                type="button"
                className={btnHdrDesktop}
                title={
                  pushState === "granted"
                    ? L(
                        "Push alerts ON for this device — tap to turn off",
                        "Makluman push HIDUP untuk peranti ini — tekan untuk matikan"
                      )
                    : L(
                        "Get push alerts on this device",
                        "Dapatkan makluman push pada peranti ini"
                      )
                }
                aria-label={L("Toggle push alerts", "Togol makluman push")}
                onClick={async () => {
                  if (pushState === "granted") {
                    await disablePush();
                    setPushState("default");
                  } else {
                    const r = await enablePush();
                    if (r === "ok") {
                      setPushState("granted");
                    } else if (r === "unconfigured")
                      window.alert(
                        L(
                          "Push isn't set up on the server yet — ask your admin to add the VAPID keys.",
                          "Push belum disediakan di pelayan — minta admin anda menambah kunci VAPID."
                        )
                      );
                    else if (r === "denied")
                      window.alert(
                        L(
                          "Notifications are blocked for this site in your browser settings.",
                          "Pemberitahuan disekat untuk laman ini dalam tetapan pelayar anda."
                        )
                      );
                  }
                }}
              >
                {pushState === "granted" ? (
                  <BellRing
                    aria-hidden
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                ) : (
                  <BellOff aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            )}
            <button
              type="button"
              className={`${btnHdr} relative`}
              aria-label={
                unread > 0
                  ? L(
                      `Notifications — ${unread} unread`,
                      `Pemberitahuan — ${unread} belum dibaca`
                    )
                  : tr("Notifications", lang)
              }
              onClick={() => {
                setShowNotifs((v) => !v);
                if (unread)
                  void api("/staff/notifications/read", {
                    method: "POST",
                    body: JSON.stringify({}),
                  });
              }}
            >
              <Bell aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white shadow">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {/* v1.9.0: theme preset + chrome language */}
            <button
              type="button"
              className={btnHdrDesktop}
              title={
                theme === "plum"
                  ? L(
                      "Theme: Plum & Rose — switch to Navy & Gold",
                      "Tema: Plum & Rose — tukar ke Navy & Gold"
                    )
                  : L(
                      "Theme: Navy & Gold — switch to Plum & Rose",
                      "Tema: Navy & Gold — tukar ke Plum & Rose"
                    )
              }
              aria-label={L("Switch colour theme", "Tukar tema warna")}
              onClick={() => setTheme(theme === "plum" ? "navy" : "plum")}
            >
              <Palette aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={`${btnHdrDesktop} text-xs font-semibold`}
              title={
                lang === "ms"
                  ? "Bahasa: BM — tukar ke English"
                  : "Language: EN — switch to Bahasa Melayu"
              }
              aria-label={L("Toggle language", "Togol bahasa")}
              onClick={() => {
                const next = lang === "ms" ? "en" : "ms";
                setLangState(next);
                persistLang(next);
              }}
            >
              {lang === "ms" ? "BM" : "EN"}
            </button>
            <button
              type="button"
              className={btnHdr}
              onClick={() => setDark((v) => !v)}
              aria-label={L("Toggle dark mode", "Togol mod gelap")}
            >
              {dark ? (
                <Sun aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
            {/* v1.16.0 (CEO): icon-only — the text label cost ~70px in a row
              that was already squeezing the greeting. title + aria-label keep
              it discoverable and announced. */}
            <button
              type="button"
              className={btnHdr}
              title={tr("Sign out", lang)}
              aria-label={tr("Sign out", lang)}
              onClick={() =>
                void api("/auth/logout", {
                  method: "POST",
                  body: JSON.stringify({}),
                }).then(() => {
                  clearApiCache();
                  setUser(null);
                })
              }
            >
              <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        {/* v1.13.0: the reference's page header — title left, breadcrumb right. */}
        <div className="mb-3 hidden items-baseline justify-between gap-4 md:flex">
          <h2 className="text-[22px] font-semibold tracking-tight">
            {tr(activeTab, lang)}
          </h2>
          <p className="text-muted-foreground text-xs">
            {tr("Staff Portal", lang)} / {tr(activeTab, lang)}
          </p>
        </div>

        {showNotifs && (
          <div className={`${card} mt-4`}>
            <p className="text-sm font-semibold">{tr("Notifications", lang)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L(
                "Last 7 days. Older notifications clear automatically.",
                "7 hari terakhir. Pemberitahuan lama dipadam secara automatik."
              )}
            </p>
            {notifs.length === 0 && (
              <p className="text-muted-foreground mt-2 text-sm">
                {L("Nothing yet.", "Tiada apa-apa lagi.")}
              </p>
            )}
            <div className="mt-1 max-h-44 overflow-y-auto pr-1">
              {notifs.map((n) => (
                <p key={n.id} className="mt-2 text-sm">
                  {n.kind === "announcement" ? (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => setTab("Announcements")}
                    >
                      {n.message}
                    </button>
                  ) : (
                    n.message
                  )}{" "}
                  <span className="text-muted-foreground text-xs">
                    · {dmy(n.created_at)}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* v1.8.0: the desktop tab-pill grid is replaced by the icon sidebar
          (SidebarNav). Phones keep the bottom navigation below. */}

        {/* App-style bottom navigation (v1.4.49) — phones only. The first four
          of this person's tabs are one thumb-tap away; the rest are in More. */}
        <nav
          className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
          /* v1.25.4 (CEO: "Why bottom nav like this?!!!" — labels sliced along
           their bottom edge on iPhone): iOS Safari reports this inset as 0 while
           its floating toolbar is shown, which removed ALL breathing room under
           the labels. max() guarantees a floor either way. */
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)",
          }}
          aria-label={L(
            "Portal sections (mobile)",
            "Bahagian portal (mudah alih)"
          )}
        >
          {/* v1.10.0 (reference design): each tab shows its sidebar icon; the
            active one sits in a filled navy rounded square — same visual
            language as the desktop sidebar's gold square. */}
          {tabs.slice(0, 4).map((t) => {
            const active = tab === t && !moreOpen;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setMoreOpen(false);
                  window.scrollTo({ top: 0 });
                }}
                aria-current={active ? "page" : undefined}
                className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
              >
                <span
                  aria-hidden
                  className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  <TabIcon name={t} />
                </span>
                {/* truncate: BM labels ("Papan Pemuka") must not wrap and
                  unbalance the row on narrow phones */}
                <span
                  className={`w-full truncate px-0.5 text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}
                >
                  {tr(t, lang)}
                </span>
              </button>
            );
          })}
          {/* v1.10.0 review fix: More renders UNCONDITIONALLY — the mobile
            Preferences (sound/push/language/theme) live in its sheet, and a
            role trimmed to ≤4 tabs would otherwise lose them entirely. */}
          {(() => {
            const active = moreOpen || tabs.indexOf(tab) >= 4;
            return (
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
              >
                <span
                  aria-hidden
                  className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  <Ellipsis
                    aria-hidden
                    className="h-[18px] w-[18px]"
                    strokeWidth={1.75}
                  />
                </span>
                <span
                  className={`w-full truncate text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}
                >
                  {tr("More", lang)}
                </span>
              </button>
            );
          })()}
        </nav>

        {moreOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label={L("Close menu", "Tutup menu")}
              className="absolute inset-0 cursor-pointer bg-black/40"
              onClick={() => setMoreOpen(false)}
            />
            {/* v1.10.0 review fix: bottom padding clears the taller nav PLUS the
              phone's home-indicator inset — the old pb-16 left the Preferences
              row half-covered and untappable on notched iPhones. */}
            <div className="border-border bg-card absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
              <div className="mb-3 flex items-center justify-between">
                <span className="w-9" />
                <button
                  type="button"
                  aria-label={L("Close menu", "Tutup menu")}
                  className="bg-border mx-auto h-1.5 w-12 rounded-full"
                  onClick={() => setMoreOpen(false)}
                />
                <button
                  type="button"
                  aria-label={L("Close", "Tutup")}
                  className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                  onClick={() => setMoreOpen(false)}
                >
                  <CloseX aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
              {tabs.length > 4 && (
                <div className="grid grid-cols-3 gap-2.5">
                  {tabs.slice(4).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTab(t);
                        setMoreOpen(false);
                        window.scrollTo({ top: 0 });
                      }}
                      className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium ${
                        tab === t
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      <span aria-hidden className="grid place-items-center">
                        <TabIcon name={t} />
                      </span>
                      {tr(t, lang)}
                    </button>
                  ))}
                </div>
              )}
              {/* v1.10.0: the set-once switches displaced from the app bar —
                sound, push alerts, language, colour theme. Same handlers as
                the desktop header buttons. */}
              <p className="text-muted-foreground mt-4 mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                {tr("Preferences", lang)}
              </p>
              <div
                className={`grid gap-2.5 ${pushState !== "unsupported" ? "grid-cols-4" : "grid-cols-3"}`}
              >
                <button
                  type="button"
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                  onClick={() => {
                    const next = !sound;
                    setSound(next);
                    localStorage.setItem(
                      "azone-notif-sound",
                      next ? "on" : "off"
                    );
                    if (next) void chime();
                  }}
                >
                  <span aria-hidden className="grid place-items-center">
                    {sound ? (
                      <Volume2
                        className="h-[18px] w-[18px]"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <VolumeX
                        className="h-[18px] w-[18px]"
                        strokeWidth={1.75}
                      />
                    )}
                  </span>
                  {sound
                    ? lang === "ms"
                      ? "Bunyi"
                      : "Sound on"
                    : lang === "ms"
                      ? "Senyap"
                      : "Muted"}
                </button>
                {pushState !== "unsupported" && (
                  <button
                    type="button"
                    className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                    onClick={async () => {
                      if (pushState === "granted") {
                        await disablePush();
                        setPushState("default");
                      } else {
                        const r = await enablePush();
                        if (r === "ok") {
                          setPushState("granted");
                        } else if (r === "unconfigured")
                          window.alert(
                            L(
                              "Push isn't set up on the server yet — ask your admin to add the VAPID keys.",
                              "Push belum disediakan di pelayan — minta admin anda menambah kunci VAPID."
                            )
                          );
                        else if (r === "denied")
                          window.alert(
                            L(
                              "Notifications are blocked for this site in your browser settings.",
                              "Pemberitahuan disekat untuk laman ini dalam tetapan pelayar anda."
                            )
                          );
                      }
                    }}
                  >
                    <span aria-hidden className="grid place-items-center">
                      {pushState === "granted" ? (
                        <BellRing
                          className="h-[18px] w-[18px]"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <BellOff
                          className="h-[18px] w-[18px]"
                          strokeWidth={1.75}
                        />
                      )}
                    </span>
                    {pushState === "granted"
                      ? lang === "ms"
                        ? "Push aktif"
                        : "Push on"
                      : lang === "ms"
                        ? "Push tutup"
                        : "Push off"}
                  </button>
                )}
                <button
                  type="button"
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                  onClick={() => {
                    const next = lang === "ms" ? "en" : "ms";
                    setLangState(next);
                    persistLang(next);
                  }}
                >
                  <span aria-hidden className="text-base font-bold">
                    {lang === "ms" ? "BM" : "EN"}
                  </span>
                  {lang === "ms" ? "Bahasa" : "English"}
                </button>
                <button
                  type="button"
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                  onClick={() => setTheme(theme === "plum" ? "navy" : "plum")}
                >
                  <span aria-hidden className="grid place-items-center">
                    <Palette className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  {theme === "plum"
                    ? lang === "ms"
                      ? "Ungu"
                      : "Plum"
                    : lang === "ms"
                      ? "Biru"
                      : "Navy"}
                </button>
              </div>
              {/* v1.23.4: the visible build stamp — "is the live site on the
                new version?" is now answerable from any phone. */}
              <p className="text-muted-foreground/70 mt-3 text-center text-[10px] tabular-nums">
                {L(
                  `A2Z CREATIVE MARKETING staff portal · v${APP_VERSION}`,
                  `Portal kakitangan A2Z CREATIVE MARKETING · v${APP_VERSION}`
                )}
              </p>
            </div>
          </div>
        )}

        <main key={tab} className="screen-enter mt-4 md:mt-6">
          {activeTab === "Dashboard" && (
            <Dashboard user={user} go={setTab} lang={lang} />
          )}
          {activeTab === "Claims" && (
            <ClaimsPanel userId={user.id} role={user.role} />
          )}
          {activeTab === "Finance" && (
            <div className="space-y-4 md:space-y-6">
              {/* v1.21.1 (CEO): Cash Flow LEADS the tab — the live bank picture
                first, the P&L and expense detail below it. */}
              <CashFlowPanel />
              <PnlCard />
              <ExpensesPanel />
            </div>
          )}
          {activeTab === "Attendance" && (
            <div className="space-y-4 md:space-y-6">
              {/* v1.8.0: the Schedule & Roster board (reference design) leads. */}
              {/* v1.22.6: canEdit — amend/typo-fix on sessions is CEO/COO/CCO
                (+ admin tier) only; hr_admin keeps scheduling powers. */}
              <RosterBoard
                canManage={[
                  "ceo",
                  "coo",
                  "cco",
                  "hr_admin",
                  "super_admin",
                  "admin",
                ].includes(user.role)}
                canEdit={["ceo", "coo", "cco", "super_admin", "admin"].includes(
                  user.role
                )}
              />
              <Attendance user={user} />
              {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? (
                <OtApprovalsCard />
              ) : (
                <PermissionPlaceholder
                  title={L("OT Approvals", "Kelulusan OT")}
                />
              )}
              {["ceo", "super_admin", "admin"].includes(user.role) ? (
                <AttendanceAdminPanel />
              ) : (
                <PermissionPlaceholder
                  title={L("Attendance Admin", "Admin Kehadiran")}
                />
              )}
            </div>
          )}
          {activeTab === "Reconciliation" && <ReconciliationPanel />}
          {activeTab === "Commission" && (
            <CommissionPanel
              canDecide={["super_admin", "ceo"].includes(user.role)}
            />
          )}
          {activeTab === "Ads Fund" && (
            <AdsFundPanel
              canManage={["super_admin", "admin", "ceo", "coo"].includes(
                user.role
              )}
            />
          )}
          {activeTab === "Purchasing" && <PurchasingPanel />}
          {activeTab === "Accounting" && <AccountingPanel />}
          {activeTab === "Leave" && <Leave user={user} />}
          {activeTab === "Tasks" && (
            <div className="space-y-4 md:space-y-6">
              <Tasks user={user} />
              {MANAGE_ROLES.includes(user.role) && <TaskProgressCard />}
            </div>
          )}
          {activeTab === "Announcements" && <Announcements user={user} />}
          {/* v1.40.0 (AUDIT M12): visibility is decided ONCE, in the tabs filter
              (role default + tab-access override). The extra role re-check here
              made Sales the only tab where an override granted by the CEO
              rendered a completely blank page. */}
          {activeTab === "Sales" && (
            <div className="space-y-4 md:space-y-6">
              {/* v1.21.0: enquiries moved here from the retired Pipeline tab —
                the inbound funnel sits with the documents it turns into. */}
              <CustomerEnquiriesCard />
              <Sales user={user} />
              {/* v1.7.0: receipts, credit notes & outstanding report */}
              <DocumentsPanel />
              <ClientsCard />
              <LiveEconomicsCard />
              <PackagesEditorCard role={user.role} />
            </div>
          )}
          {/* v1.21.0: the Pipeline tab is retired (CEO: "Sales pipeline is
            really needed?? I dont think so"). Customer enquiries — the real
            inbound funnel — moved onto the Sales tab above. */}
          {activeTab === "Content" && (
            <ContentPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
                "editor",
                "live_host",
              ].includes(user.role)}
            />
          )}
          {activeTab === "Stokis" && (
            <StokisPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
              ].includes(user.role)}
            />
          )}
          {activeTab === "HR" && (
            <div className="space-y-4 md:space-y-6">
              <HrPanel />
              {["hr_admin", "ceo", "super_admin", "admin"].includes(
                user.role
              ) ? (
                <HrAdminPanel />
              ) : (
                <PermissionPlaceholder
                  title={L("HR Administration", "Pentadbiran HR")}
                />
              )}
            </div>
          )}
          {activeTab === "Payroll" && <PayrollPanel />}
          {activeTab === "Staff Details" && (
            <div className="space-y-4 md:space-y-6">
              <StaffDirectory
                canAmend={["super_admin", "admin", "ceo"].includes(user.role)}
                readOnly={["coo", "cco"].includes(user.role)}
              />
              {/* v1.19.0 C1: the Birthdays tab folded in here — one staff-record
                surface. Same component, same single-field PATCH. */}
              <BirthdaysPanel />
            </div>
          )}
          {activeTab === "Inventory" && (
            <div className="flex flex-col gap-4 md:gap-6">
              {/* v1.21.1 (CEO): status strip FIRST, minimal — the health
                read before the table. flex-col so the strip self-starts
                instead of stretching full width. */}
              {MANAGE_ROLES.includes(user.role) && <InventoryStatusCard />}
              <InventoryPanel role={user.role} />
            </div>
          )}
          {activeTab === "Web Orders" && (
            <WebOrdersPanel />
          )}
          {activeTab === "Ecommerce" && (
            <div className="space-y-3 md:space-y-6">
              {/* v1.4.214 (CEO): every TikTok / e-commerce card in one place —
                connection health, the order tracker, LIVE GMV, the hourly
                histogram and the fulfilment pipeline. */}
              {/* v1.4.217 (CEO's order): Orders → GMV → by-hour → Fulfilment
                → Connection status last (plumbing below the business).
                v1.4.277: Sales revenue leads the tab (moved from Dashboard
                per CEO — the month summary above the channel detail). */}
              {/* v1.21.1 (CEO): the map LEADS the tab — where the country is
                buying, at a glance, before the detail cards. */}
              {REVENUE_ROLES.includes(user.role) && <OpsMapCard />}
              {REVENUE_ROLES.includes(user.role) && (
                <LeaderboardCard user={user} />
              )}
              {TARGET_ADMIN_ROLES.includes(user.role) && (
                <TargetsCommissionCard />
              )}
              {REVENUE_ROLES.includes(user.role) && <SalesHistoryCard />}
              {REVENUE_ROLES.includes(user.role) && <SalesRevenueCard />}
              {REVENUE_ROLES.includes(user.role) && <BusinessLinesCard />}
              <TikTokOrdersCard
                role={user.role}
                onChanged={() => {
                  /* stock views live on Inventory */
                }}
              />
              {REVENUE_ROLES.includes(user.role) && <SalesByHourCard />}
              {REVENUE_ROLES.includes(user.role) && <FulfilmentCard />}
              <ConnectionStatusCard />
            </div>
          )}
          {/* v1.5.0: Social tab removed on the CEO's direction. */}
          {activeTab === "Assets" && <AssetsPanel />}
          {activeTab === "Users" && (
            <div className="space-y-4 md:space-y-6">
              {["ceo", "super_admin"].includes(user.role) && <TabAccessCard />}
              {["super_admin", "ceo", "coo"].includes(user.role) && (
                <GeofenceCard />
              )}
              <UsersPanel role={user.role} />
            </div>
          )}
          {activeTab === "Profile" && (
            <div className="space-y-4 md:space-y-6">
              <Profile />
              <MyPayslip />
              <TwoFactorPanel />
              {/* v1.4.191: staff read how their personal data (NRIC, bank,
                photos, payroll) is handled — PDPA notice */}
              <p className="text-muted-foreground text-center text-xs">
                <a
                  className="underline"
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L(
                    "How your personal data is handled — Privacy Notice (PDPA)",
                    "Bagaimana data peribadi anda diurus — Notis Privasi (PDPA)"
                  )}
                </a>
              </p>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
