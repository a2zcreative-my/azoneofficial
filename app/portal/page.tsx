"use client";

/**
 * AZ ONE OFFICIAL — Staff Portal v1 (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 * Modules: Dashboard, Attendance, Leave, Tasks, Announcements, Sales, Profile,
 * plus role modules (v1.4.4): HR, Inventory, Commercial, Operations, Overview.
 * Desktop-first, responsive; light/dark mode.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { enablePush, disablePush, pushPermission } from "@/lib/push-client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { properName, firstName } from "@/lib/names";
import { buildDocHtml, type DocFull, type DocItem } from "@/lib/doc-template";
import { buildDocPdf, sharePdfFile } from "@/lib/doc-pdf";
import { buildLeavePdf } from "@/lib/form-pdf";
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
import { TabAccessCard } from "@/components/portal/tab-access-card";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import {
  AttendanceAdminPanel,
  BirthdaysPanel,
  HrPanel,
  InventoryPanel,
  OverviewPanel,
  ClaimsPanel,
  ExpensesPanel, TikTokOrdersCard } from "@/components/portal/role-panels";
import { StaffDirectory } from "@/components/staff/staff-directory";
import { card, inputClass, btnClass, btnGhost, btnHdr, btnSm, btnSmPrimary, th, td, thR2, tdR2, fieldRow } from "@/lib/ui-styles";
import { dmy, mytToday, mytDateOf, fmtRM, ym } from "@/lib/format";


interface User { id: number; email: string; name: string; role: string; photo_key?: string | null; requires_2fa?: boolean }




/**
 * Attendance timestamps are stored in UTC (datetime('now') in D1) — correct
 * for storage, wrong to show raw. These format them in Malaysia time
 * (Asia/Kuala_Lumpur, UTC+8) for display and day-grouping, so a 10:00am
 * clock-in reads 10:00, not 02:00.
 */
function mytTime(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function mytDateTime(iso: string): string {
  // DD-MM-YYYY HH:mm in Malaysia time — the one date format system-wide.
  const d = new Date(new Date(iso.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

const MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]; // v1.4.153: CEO posts news too
const SALES_ROLES = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"];


/* ================= Dashboard ================= */

interface Notification { id: number; kind: string; message: string; is_read: number; created_at: string }
interface Task { id: number; title: string; priority: string; deadline: string | null; status: string; progress: number; assignee?: string }
interface Announcement { id: number; title: string; body: string; category: string; created_at: string; acked: number }
interface LeaveReq { id: number; type: string; start_date: string; end_date: string; days: number; status: string; stage?: string; applicant_role?: string; user_id?: number; user_name?: string; review_comment?: string | null;
  // v1.4.134: printable Leave Application Form fields
  reason?: string | null; created_at?: string; day_seq?: number | null;
  user_full?: string | null; user_position?: string | null; user_department?: string | null;
  hr_by_name?: string | null; hr_at?: string | null;
  preapp_by_name?: string | null; preapp_by_full?: string | null; preapp_by_role?: string | null; preapp_at?: string | null;
  final_by_name?: string | null; final_by_full?: string | null; final_at?: string | null }

/**
 * Punch confirmation overlay (v1.4.29): centered card, animated ring +
 * check draw, brand navy, auto-dismisses. Pure CSS keyframes — no library.
 */

/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

function PunchToast({ title, sub, variant = "success" }: { title: string; sub: string; variant?: "success" | "notice" }) {
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
        style={{ animation: "punch-pop .45s cubic-bezier(.2,.9,.3,1.2) both, punch-fade .4s ease .2s forwards", animationDelay: "0s, 2.2s" }}
        role="status"
        aria-live="polite"
      >
        <svg viewBox="0 0 52 52" className="mx-auto h-14 w-14" aria-hidden="true">
          <circle cx="26" cy="26" r="24" fill="none" stroke={colour} strokeWidth="2.5"
            strokeDasharray="151" style={{ animation: "punch-ring .6s ease-out .1s both" }} />
          {variant === "success" ? (
            <path d="M15 27l7.5 7.5L37 20" fill="none" stroke={colour} strokeWidth="3.5"
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray="36"
              style={{ animation: "punch-check .35s ease-out .55s both" }} />
          ) : (
            <g style={{ animation: "punch-check .35s ease-out .55s both" }}>
              <path d="M26 14v16" fill="none" stroke={colour} strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray="16" />
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

function Dashboard({ user, go }: { user: User; go: (t: TabName) => void }) {
  const [today, setToday] = useState<{ type: string; created_at: string }[]>([]);
  const [todayOt, setTodayOt] = useState<{ type: string; created_at: string }[]>([]);
  const [otEligible, setOtEligible] = useState(false);
  const [leave, setLeave] = useState<LeaveReq[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [anns, setAnns] = useState<Announcement[]>([]);
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

  const load = useCallback(async () => {
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const a = await api<{ records: { type: string; created_at: string }[]; ot?: { type: string; created_at: string }[]; ot_eligible?: boolean }>(`/staff/attendance?month=${month}`);
    setToday((a.data?.records ?? []).filter((r) => mytDateOf(r.created_at) === mytToday()));
    setTodayOt((a.data?.ot ?? []).filter((r) => mytDateOf(r.created_at) === mytToday()));
    setOtEligible(a.data?.ot_eligible === true);
    const l = await api<{ leave: LeaveReq[] }>(`/staff/leave`);
    setLeave((l.data?.leave ?? []).filter((x) => x.status === "pending"));
    const t = await api<{ tasks: Task[] }>(`/staff/tasks`);
    setTasks((t.data?.tasks ?? []).filter((x) => x.status !== "completed").slice(0, 5));
    const n = await api<{ announcements: Announcement[] }>(`/staff/announcements`);
    setAnns((n.data?.announcements ?? []).slice(0, 3));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const [punchToast, setPunchToast] = useState<{ title: string; sub: string; variant?: "success" | "notice" } | null>(null);
  const [punchError, setPunchError] = useState("");
  const punch = async (type: string) => {
    // v1.4.113: flow is clock IN → clock OUT. Trying to clock out before
    // clocking in gets an instant popup (and the server refuses it too).
    if (type === "clock_out" && !today.some((r) => r.type === "clock_in")) {
      setPunchToast({
        title: "Clock in first",
        sub: "You haven't clocked in today — clock in first, then clock out at the end of your shift.",
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    setBusy(type);
    setPunchError("");
    const res = await api<{ flag?: string; error?: { message?: string } }>(`/staff/attendance`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    setBusy("");
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      // Already punched today — confirm it with the recorded time rather than
      // leaving the person unsure whether the tap registered.
      setPunchToast({
        title: type === "clock_in" ? "Already clocked in" : "Already clocked out",
        sub: res.data?.error?.message?.replace(/^You already clocked (in|out) today at /, "Recorded at ") ?? "Recorded earlier today",
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.flag) {
      const label: Record<string, string> = {
        ok: "On time", late: "Marked late", half_day: "Half day (after 12:00)",
        early_out: "Early out (before 18:00)", completed: "Shift completed",
      };
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const hhmm = now.toISOString().slice(11, 16);
      setPunchToast({
        title: type === "clock_in" ? "Clock-in recorded" : "Clock-out recorded",
        sub: `${label[res.data.flag] ?? res.data.flag} · ${hhmm} MYT`,
      });
      window.setTimeout(() => setPunchToast(null), 2600);
    } else if ((res.data?.error as { code?: string } | undefined)?.code === "no_clock_in") {
      setPunchToast({ title: "Clock in first", sub: res.data?.error?.message ?? "Clock in before clocking out.", variant: "notice" });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else {
      setPunchError(res.data?.error?.message ?? "Punch failed — try again.");
    }
    void load();
  };

  // v1.4.155: overtime punches. OT is pre-approved by the Section HOD — these
  // buttons record the hours, they are not the approval itself, and the toast
  // reminds the staff member of that every time.
  const punchOt = async (type: string) => {
    if (!today.some((r) => r.type === "clock_in")) {
      setPunchToast({ title: "Clock in first", sub: "No clock-in recorded today — overtime can only follow a worked day.", variant: "notice" });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    if (type === "ot_out" && !todayOt.some((r) => r.type === "ot_in")) {
      setPunchToast({ title: "OT in first", sub: "Tap OT in when overtime starts, then OT out when you finish.", variant: "notice" });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    setBusy(type);
    setPunchError("");
    const res = await api<{ at?: string; error?: { message?: string } }>(`/staff/attendance/ot`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    setBusy("");
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      setPunchToast({
        title: type === "ot_in" ? "OT in already recorded" : "OT out already recorded",
        sub: res.data?.error?.message?.replace(/^You already recorded OT (in|out) today at /, "Recorded at ") ?? "Recorded earlier today",
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.at) {
      setPunchToast({
        title: type === "ot_in" ? "OT in recorded" : "OT out recorded",
        sub: type === "ot_in"
          ? `${res.data.at} MYT — only proceed if your Section HOD approved this overtime.`
          : `${res.data.at} MYT — overtime completed. Thank you.`,
      });
      window.setTimeout(() => setPunchToast(null), 3200);
    } else if (res.data?.error?.message) {
      setPunchToast({ title: "Overtime", sub: res.data.error.message, variant: "notice" });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else {
      setPunchError("OT punch failed — try again.");
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
  const isWeekendMYT = [0, 6].includes(new Date(Date.now() + 8 * 3600 * 1000).getUTCDay());
  const showOt = otEligible && (isWeekendMYT || nowMins >= 18 * 60 || todayOt.length > 0);

  return (
    <div className="space-y-3 md:space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">Quick actions</p>
        {/* v1.4.146: 2-up grid on phones — equal-width, thumb-friendly, no
            ragged wrapping; the desktop keeps its inline row. */}
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" className={`${btnClass} justify-center sm:justify-start`} disabled={!!busy} onClick={() => void punch("clock_in")}>
            {hasIn ? "Clocked in ✓" : "Clock in"}
          </button>
          <button type="button" className={`${btnGhost} justify-center sm:justify-start`} disabled={!!busy} onClick={() => void punch("clock_out")}>
            {hasOut ? "Clocked out ✓" : "Clock out"}
          </button>
          <button type="button" className={`${btnGhost} justify-center sm:justify-start`} onClick={() => go("Leave")}>Apply leave</button>
          {SALES_ROLES.includes(user.role) && (
            <button type="button" className={`${btnGhost} justify-center sm:justify-start`} onClick={() => go("Sales")}>Create quotation</button>
          )}
          {showOt && (
            <>
              <button type="button"
                className={`${hasOtIn ? btnGhost : btnClass} justify-center sm:justify-start`}
                disabled={!!busy} onClick={() => void punchOt("ot_in")}>
                {hasOtIn ? "OT in ✓" : "OT in"}
              </button>
              <button type="button" className={`${btnGhost} justify-center sm:justify-start`}
                disabled={!!busy} onClick={() => void punchOt("ot_out")}>
                {hasOtOut ? "OT out ✓" : "OT out"}
              </button>
            </>
          )}
        </div>
        {showOt && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Working overtime today? OT in / OT out only with your Section HOD&apos;s approval — tap OT in when it starts and OT out when you finish.{isWeekendMYT ? " Weekend: the whole day counts as overtime — no normal clock-in needed." : ""}
          </p>
        )}
        {punchError && <p className="text-destructive mt-2 text-xs font-medium">{punchError}</p>}
        {punchToast && <PunchToast title={punchToast.title} sub={punchToast.sub} variant={punchToast.variant} />}
        <p className="text-muted-foreground mt-3 text-xs">
          {today.length === 0 && todayOt.length === 0
            ? "No attendance recorded today."
            : `Today: ${[...today.slice().reverse(), ...todayOt.slice().reverse()]
                .map((r) => `${r.type.startsWith("ot_") ? r.type.replace("ot_", "OT ") : r.type.replace("_", " ")} ${mytTime(r.created_at)}`)
                .join(" · ")}`}
        </p>
      </div>

      {/* v1.4.214 (CEO reorg): LiveGmvCard + ConnectionStatusCard moved to
          the new Ecommerce tab — the Dashboard is Quick actions → the
          three-column day view → Upcoming events. */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className={card}>
          <p className="cursor-pointer text-sm font-semibold" role="button" tabIndex={0}
            onClick={() => go("Leave")} onKeyDown={(e) => e.key === "Enter" && go("Leave")}>
            Pending leave
            {leave.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {leave.length}
              </span>
            )}
          </p>
          {leave.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">None pending.</p>
          ) : (
            leave.map((l) => (
              <p key={l.id} className="mt-2 text-sm">
                {l.type} · {dmy(l.start_date)} → {dmy(l.end_date)} ({l.days}d)
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p className="cursor-pointer text-sm font-semibold" role="button" tabIndex={0}
            onClick={() => go("Tasks")} onKeyDown={(e) => e.key === "Enter" && go("Tasks")}>
            My open tasks
            {tasks.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {tasks.length}
              </span>
            )}
          </p>
          {tasks.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">Nothing assigned.</p>
          ) : (
            tasks.map((t) => (
              <p key={t.id} className="mt-2 text-sm">
                {t.title} <span className="text-muted-foreground">· {t.priority}{t.deadline ? ` · due ${t.deadline}` : ""}</span>
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p className="cursor-pointer text-sm font-semibold" role="button" tabIndex={0}
            onClick={() => go("Announcements")} onKeyDown={(e) => e.key === "Enter" && go("Announcements")}>
            News
            {anns.length > 0 && (
              <span className="ml-2 inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true"></span>
            )}
          </p>
          {anns.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">No announcements.</p>
          ) : (
            anns.map((a) => (
              <p key={a.id} className="mt-2 text-sm">
                <span className="font-medium">{a.title}</span>{" "}
                <span className="text-muted-foreground">· {a.category}</span>
              </p>
            ))
          )}
        </div>
      </div>
      {/* v1.5.0: the hero band became the Sales Floor — a trading-desk view
          of today, the KPI target (auto-computed from history), product vs
          service market targets, motivation and boost suggestions. */}
      <TradingDesk user={user} />

      {/* v1.4.277 (CEO): Sales revenue MOVED to the Ecommerce tab — the
          hero band already carries today + month + overall up top, so the
          detailed month card was the Dashboard's third telling of the same
          story. Ecommerce is where the channel detail lives. */}
      <UpcomingEventsCard role={user.role} />
    </div>
  );
}

/* ================= Sales revenue (v1.4.75) ================= */

const REVENUE_ROLES = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

interface RevenueData {
  month: string;
  last_month: string;
  today?: { date: string; tiktok_cents: number; tiktok_orders: number; invoiced_cents: number; invoiced_docs: number; other_cents?: number; manual_cents?: number };
  yesterday?: { date: string; total_cents: number };  // v1.4.206 trend arrow
  other?: { this_cents: number; this_orders: number; last_cents: number; last_orders: number };  // v1.4.169 non-TikTok shipments
  manual?: { this_cents: number; this_units: number; last_cents: number; last_units: number };   // v1.4.169 manual sales
  tiktok: { this_cents: number; this_orders: number; last_cents: number; last_orders: number };
  invoiced: { this_cents: number; this_docs: number; last_cents: number; last_docs: number };  outstanding?: { cents: number; docs: number };
  overall?: { total_cents: number; months: { month: string; cents: number }[]; best?: { month: string; cents: number } };  // v1.4.276 all-time, all channels
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
interface DashSummary { today: string; pending_leave: number | null; pending_claims: number | null; pending_ot: number | null; low_stock: number | null; open_quotations: number | null }

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

interface RevLineLite { key: string; label: string; total_cents: number; months: { month: string; cents: number }[] }
interface HourBucket { hour: number; cents: number; orders: number }

/** Auto-target: beat last month by 10%, rounded UP to the next RM500.
    No history yet → no target (never invent a number). */
function autoTargetCents(lastCents: number): number | null {
  if (lastCents <= 0) return null;
  const raised = lastCents * 1.1;
  return Math.ceil(raised / 50_000) * 50_000;
}

function TradingDesk({ user }: { user: User }) {
  const [rev, setRev] = useState<RevenueData | null>(null);
  const [sum, setSum] = useState<DashSummary | null>(null);
  const [mkLines, setMkLines] = useState<RevLineLite[] | null>(null);
  const [hours, setHours] = useState<HourBucket[] | null>(null);
  const canRevenue = REVENUE_ROLES.includes(user.role);
  const canStatus = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"].includes(user.role);
  // v1.6.1 (CEO): the monthly KPI target is set right here on the dashboard,
  // and only these three roles may change it.
  const canEditKpi = ["super_admin", "ceo", "coo"].includes(user.role);
  const [editingKpi, setEditingKpi] = useState(false);
  const [kpiDraft, setKpiDraft] = useState("");
  const { show: showKpiToast, node: kpiToastNode } = useSaveToast();
  const loadRev = useCallback(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => { if (r.ok && r.data) setRev(r.data); });
  }, []);
  useEffect(() => {
    if (canRevenue) {
      loadRev();
      void api<{ lines: RevLineLite[] }>(`/staff/revenue/lines`).then((r) => { if (r.ok && r.data) setMkLines(r.data.lines); });
      void api<{ buckets: HourBucket[] }>(`/staff/sales/by-hour`).then((r) => { if (r.ok && r.data) setHours(r.data.buckets); });
    }
    void api<DashSummary>(`/staff/dashboard/summary`).then((r) => { if (r.ok && r.data) setSum(r.data); });
  }, [canRevenue, loadRev]);

  const saveKpi = async () => {
    const v = Number(kpiDraft);
    if (!rev) return;
    if (!v || v <= 0) { showKpiToast("No change", "Enter a target amount first", "notice"); return; }
    const res = await api(`/staff/revenue/target`, { method: "POST", body: JSON.stringify({ month: rev.month, target_cents: Math.round(v * 100) }) });
    if (res.ok) { showKpiToast("Saved", `Monthly KPI target — ${fmtRM(Math.round(v * 100))}`); setEditingKpi(false); loadRev(); }
  };

  /* ---- shared derived figures ---- */
  const monthTotal = rev ? rev.tiktok.this_cents + rev.invoiced.this_cents + (rev.other?.this_cents ?? 0) + (rev.manual?.this_cents ?? 0) : 0;
  const lastTotal = rev ? rev.tiktok.last_cents + rev.invoiced.last_cents + (rev.other?.last_cents ?? 0) + (rev.manual?.last_cents ?? 0) : 0;
  // Manual target (set on the Ecommerce tab) wins; otherwise auto from history.
  const autoT = autoTargetCents(lastTotal);
  const target = rev?.target_cents || autoT;
  const targetIsAuto = !rev?.target_cents && !!autoT;
  const nowM = new Date(Date.now() + 8 * 3600 * 1000);
  const daysInMonth = new Date(Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = nowM.getUTCDate();
  const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const pct = target ? Math.round((monthTotal / target) * 100) : null;
  const onPace = pct !== null && pct >= expectedPct;

  /* ---- ticker cards ---- */
  const ticker: ReactNode[] = [];
  if (canRevenue && rev?.today) {
    const t = rev.today;
    const todayTotal = t.tiktok_cents + t.invoiced_cents + (t.other_cents ?? 0) + (t.manual_cents ?? 0);
    const y = rev.yesterday?.total_cents ?? 0;
    const up = todayTotal >= y;
    ticker.push(
      <div key="today" className="rounded-xl bg-brand p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold tracking-wider uppercase text-white/70">🔥 Today&apos;s sales · LIVE</p>
        <p className="mt-1 text-2xl leading-tight font-bold tabular-nums">{fmtRM(todayTotal)}</p>
        {(todayTotal > 0 || y > 0) && (
          <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${up ? "bg-bull/25 text-green-200" : "bg-bear/25 text-red-200"}`}>
            {up ? "▲" : "▼"} {fmtRM(Math.abs(todayTotal - y))} vs yesterday
          </p>
        )}
        <p className="mt-1 text-xs text-white/80">
          {t.tiktok_orders} TikTok order{t.tiktok_orders === 1 ? "" : "s"}
          {t.invoiced_cents > 0 ? ` · invoiced ${fmtRM(t.invoiced_cents)}` : ""}
        </p>
      </div>,
    );
  }
  if (canRevenue && rev) {
    ticker.push(
      <StatCard key="month" label={`Revenue — ${ym(rev.month)}`}
        value={fmtRM(monthTotal)}
        bar={target ? { pct: (monthTotal / target) * 100, label: `${Math.round((monthTotal / target) * 100)}% of ${fmtRM(target)}${targetIsAuto ? " auto-target" : " target"}`, tone: monthTotal >= target ? "green" : "gold" } : undefined}
        sub={target ? undefined : "first month of data — the auto-target starts next month"} />,
    );
    if (rev.overall && rev.overall.total_cents > 0) {
      const ov = rev.overall;
      const best = ov.best;
      const thisMonthCents = ov.months.find((m) => m.month === rev.month)?.cents ?? 0;
      ticker.push(
        <StatCard key="overall" label="📈 All-time — every channel"
          value={fmtRM(ov.total_cents)}
          bar={best && best.cents > 0 ? { pct: (thisMonthCents / best.cents) * 100, label: best.month === rev.month ? "this month is your best yet 🏆" : `vs best month (${ym(best.month)} · ${fmtRM(best.cents)})`, tone: thisMonthCents >= best.cents ? "green" : "navy" } : undefined}
          sub={`${ov.months.length} month${ov.months.length === 1 ? "" : "s"} of business`} />,
      );
    }
  }
  // v1.6.1 (CEO): "Needs attention" sits in the top ticker row, right beside
  // the All-time card (position 4), instead of a separate strip at the bottom.
  if (canStatus && sum) {
    const rows: [string, number | null][] = [
      ["Leave pending", sum.pending_leave],
      ["Claims pending", sum.pending_claims],
      ["OT pending", sum.pending_ot],
      ["Low stock", sum.low_stock],
      ["Quotations open", sum.open_quotations],
    ];
    const shown = rows.filter(([, v]) => v !== null && v > 0);
    ticker.push(
      <div key="attention" className="border-border bg-card rounded-xl border border-t-2 border-t-brand p-4 shadow-sm">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Needs attention</p>
        {shown.length === 0
          ? <p className="mt-2 text-sm">✅ Nothing waiting on you</p>
          : (
            <div className="mt-1.5 space-y-1">
              {shown.map(([label, v]) => (
                <p key={label} className="flex items-baseline justify-between text-sm">
                  <span>{label}</span>
                  <span className="font-bold tabular-nums">{v}</span>
                </p>
              ))}
            </div>
          )}
      </div>,
    );
  }
  // Unpaid invoices card comes last (only when there are any) so it never
  // pushes "Needs attention" out of the top row.
  if (canRevenue && rev?.outstanding && rev.outstanding.docs > 0) {
    ticker.push(
      <StatCard key="out" accent="red" label="Unpaid invoices"
        value={fmtRM(rev.outstanding.cents)}
        sub={`${rev.outstanding.docs} invoice${rev.outstanding.docs === 1 ? "" : "s"} awaiting payment — collect first`} />,
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
      return { key: l.key, label: l.label.split(" (")[0] ?? l.key, now, last, target: t };
    })
    .filter((m) => m.now > 0 || m.last > 0);

  /* ---- motivation ---- */
  let motivation: { emoji: string; text: string; cls: string } | null = null;
  if (canRevenue && rev && target && pct !== null) {
    const daysLeft = Math.max(1, daysInMonth - dayOfMonth);
    const needPerDay = Math.max(0, target - monthTotal) / daysLeft;
    if (pct >= 100) {
      motivation = { emoji: "🏆", text: `TARGET SMASHED — ${fmtRM(monthTotal)} against ${fmtRM(target)}. Every ringgit from here is a new record. Set the bar higher!`, cls: "bg-success-soft text-success" };
    } else if (onPace) {
      motivation = { emoji: "✅", text: `On pace — day ${dayOfMonth}/${daysInMonth} expects ~${expectedPct}%, you're at ${pct}%. Hold this rhythm and the month is yours.`, cls: "bg-success-soft text-success" };
    } else if (expectedPct - pct <= 15) {
      motivation = { emoji: "⚡", text: `Push time — ${pct}% done, pace says ${expectedPct}%. ${fmtRM(Math.round(needPerDay))} a day for the next ${daysLeft} day${daysLeft === 1 ? "" : "s"} closes the gap. One good LIVE changes this.`, cls: "bg-warning-soft text-warning" };
    } else {
      motivation = { emoji: "🚀", text: `Comeback mode — ${fmtRM(Math.max(0, target - monthTotal))} to go. Break it down: that's ${fmtRM(Math.round(needPerDay))} a day. Book the lives, chase the quotes, move the stock.`, cls: "bg-danger-soft text-danger" };
    }
  }

  /* ---- data-driven boost suggestions ---- */
  const tips: string[] = [];
  if (canRevenue && rev) {
    const peak = (hours ?? []).reduce<HourBucket | null>((a, b) => (b.cents > (a?.cents ?? 0) ? b : a), null);
    if (peak && peak.cents > 0) {
      tips.push(`Schedule the next LIVE at ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00 — your best-selling hour this week (${fmtRM(peak.cents)} across ${peak.orders} orders).`);
    }
    if (rev.outstanding && rev.outstanding.docs > 0) {
      tips.push(`Chase the ${rev.outstanding.docs} unpaid invoice${rev.outstanding.docs === 1 ? "" : "s"} (${fmtRM(rev.outstanding.cents)}) — it's revenue you already earned.`);
    }
    if ((sum?.open_quotations ?? 0) > 0) {
      tips.push(`${sum!.open_quotations} quotation${sum!.open_quotations === 1 ? "" : "s"} still open — a follow-up call today converts faster than a new lead.`);
    }
    if ((sum?.low_stock ?? 0) > 0) {
      tips.push(`${sum!.low_stock} item${sum!.low_stock === 1 ? "" : "s"} low on stock — restock before the next live so a bestseller never sells out mid-stream.`);
    }
    const weakest = markets.filter((m) => m.target && m.now < m.target).sort((a, b) => (a.now / a.target!) - (b.now / b.target!))[0];
    if (weakest?.target) {
      tips.push(`${weakest.label} is at ${Math.round((weakest.now / weakest.target) * 100)}% of its market target — ${fmtRM(weakest.target - weakest.now)} more takes it home.`);
    }
  }

  if (ticker.length === 0 && !canStatus) return null;

  return (
    <div className="space-y-3 md:space-y-4">
      {kpiToastNode}
      {/* Zone 1 — the ticker (Today · Revenue · All-time · Needs attention) */}
      {ticker.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{ticker}</div>
      )}

      {/* Zone 2+3 — KPI + markets, one desk card */}
      {canRevenue && rev && (target || markets.length > 0 || canEditKpi) && (
        <div className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">📊 Sales floor — {ym(rev.month)}</p>
            <p className="text-muted-foreground text-xs tabular-nums">day {dayOfMonth}/{daysInMonth} · pace {expectedPct}%</p>
          </div>

          {/* v1.6.1: set/edit the monthly KPI target right here (CEO/COO/super). */}
          {editingKpi ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <span className="text-sm font-medium">Target for {ym(rev.month)}:</span>
              <span className="flex items-center gap-1 text-sm">RM
                <input type="number" min={0} step="0.01" autoFocus
                  className="border-input bg-background h-9 w-36 rounded-lg border px-2 text-sm"
                  placeholder="e.g. 35000" value={kpiDraft}
                  onChange={(e) => setKpiDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveKpi(); if (e.key === "Escape") setEditingKpi(false); }} />
              </span>
              <button type="button" className={btnSmPrimary} onClick={() => void saveKpi()}>Save target</button>
              <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setEditingKpi(false)}>Cancel</button>
            </div>
          ) : (
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold tracking-wide uppercase">
                  🎯 KPI — month target {target ? (targetIsAuto ? "(auto: last month +10%)" : "") : ""}
                </span>
                <span className="flex items-baseline gap-2">
                  {target ? <span className="tabular-nums font-bold">{fmtRM(monthTotal)} / {fmtRM(target)}</span> : <span className="text-muted-foreground">no target set</span>}
                  {canEditKpi && (
                    <button type="button" className="text-gold-deep text-xs font-medium underline"
                      onClick={() => { setKpiDraft(rev.target_cents ? (rev.target_cents / 100).toString() : (target ? (target / 100).toString() : "")); setEditingKpi(true); }}>
                      {rev.target_cents ? "Edit target" : "Set target"}
                    </button>
                  )}
                </span>
              </div>
              {target && pct !== null && (
                <div className="relative mt-1.5 h-5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-bull" : pct >= 70 ? "bg-gold-solid" : pct >= 40 ? "bg-warning" : "bg-bear"}`}
                    style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }} />
                  {/* pace marker: where the month says you SHOULD be */}
                  <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${Math.min(99, expectedPct)}%` }} title={`pace: ${expectedPct}%`} />
                  <span className={`absolute inset-0 flex items-center text-[11px] font-bold ${pct >= 12 ? "justify-start pl-2 text-white" : "justify-start text-foreground"}`}
                    style={pct < 12 ? { paddingLeft: `calc(${Math.max(pct, 1)}% + 6px)` } : undefined}>
                    {pct}%
                  </span>
                </div>
              )}
              {!target && canEditKpi && (
                <p className="text-muted-foreground mt-1 text-[11px]">Set this month&apos;s KPI target to turn on the progress bar and the pace tracker.</p>
              )}
            </div>
          )}
          {motivation && (
            <p className={`mt-2.5 rounded-lg px-3 py-2 text-xs font-medium ${motivation.cls}`}>
              {motivation.emoji} {motivation.text}
            </p>
          )}
          {markets.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Market targets — product · service</p>
              <div className="mt-1.5 space-y-2">
                {markets.map((m) => {
                  const mPct = m.target ? Math.round((m.now / m.target) * 100) : null;
                  return (
                    <div key={m.key} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 capitalize md:w-32">{m.label}</span>
                      <div className="flex-1">
                        <MiniBar pct={m.target ? (m.now / m.target) * 100 : (m.now > 0 ? 100 : 0)}
                          tone={mPct !== null && mPct >= 100 ? "green" : m.key === "service" ? "gold" : "navy"} />
                      </div>
                      <span className="shrink-0 text-right text-xs tabular-nums md:text-sm">
                        <span className="font-semibold">{fmtRM(m.now)}</span>
                        {m.target && <span className="text-muted-foreground"> / {fmtRM(m.target)} ({mPct}%)</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1 text-[11px]">Each line&apos;s target = its own last month + 10% (auto). Momentum, per business.</p>
            </div>
          )}
          {tips.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">💡 Boost the number</p>
              <ul className="mt-1.5 space-y-1">
                {tips.slice(0, 4).map((t) => (
                  <li key={t} className="flex gap-2 text-xs">
                    <span aria-hidden className="text-gold-deep">▸</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SalesRevenueCard() {
  const [rev, setRev] = useState<RevenueData | null>(null);
  const loadRev = useCallback(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => { if (r.ok && r.data) setRev(r.data); });
  }, []);
  useEffect(() => { loadRev(); }, [loadRev]);
  if (!rev) return null;
  const rm = fmtRM; // v1.4.272: the global — a money figure must never render two ways
  // v1.4.169 (CEO: "everything count correctly and accurately"): total sales
  // = TikTok + paid invoices + non-TikTok shipments + manual sales. The KPI
  // progress below uses this same total, so the target tracks EVERY channel.
  const total = rev.tiktok.this_cents + rev.invoiced.this_cents + (rev.other?.this_cents ?? 0) + (rev.manual?.this_cents ?? 0);
  const lastTotal = rev.tiktok.last_cents + rev.invoiced.last_cents + (rev.other?.last_cents ?? 0) + (rev.manual?.last_cents ?? 0);
  const delta = lastTotal > 0 ? Math.round(((total - lastTotal) / lastTotal) * 100) : null;
  const box = (label: string, value: string, sub: string) => (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>
    </div>
  );
  return (
    <div className={card}>
      <p className="text-sm font-semibold">Sales revenue — {rev.month}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        TikTok figures from synced order amounts (returned orders excluded).
        Invoiced figures count PAYMENTS RECEIVED (paid invoices, in the month
        the payment landed) — comparable with Expenses. The Total also counts
        non-TikTok shipments (order amount on the postage form) and manual
        sales (an Out − with a sold price) — every channel, one number.
        {/* v1.6.1: the KPI target moved to the Dashboard (set by CEO/COO). */}
      </p>
      {/* v1.4.156 (CEO: "show today sales to motivate my Sales team") —
          today leads the grid with the brand-gold accent. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* v1.4.271 audit: the 🔥 Today box moved OUT of this card — the
            hero band above owns "today" now; two cards both saying today's
            number was the audit's first finding. This card is the MONTH view. */}
        {box("TikTok Shop", rm(rev.tiktok.this_cents), `${rev.tiktok.this_orders} orders · last month ${rm(rev.tiktok.last_cents)}`)}
        {box("Invoiced (paid)", rm(rev.invoiced.this_cents), `${rev.invoiced.this_docs} paid · last month ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · outstanding ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`)}
        {/* v1.4.169: the other two channels, so the Total is ALL sales */}
        {box("Other shipments", rm(rev.other?.this_cents ?? 0), `${rev.other?.this_orders ?? 0} non-TikTok order${(rev.other?.this_orders ?? 0) === 1 ? "" : "s"} with amount · last month ${rm(rev.other?.last_cents ?? 0)}`)}
        {box("Manual sales", rm(rev.manual?.this_cents ?? 0), `${rev.manual?.this_units ?? 0} unit${(rev.manual?.this_units ?? 0) === 1 ? "" : "s"} sold via Out − · last month ${rm(rev.manual?.last_cents ?? 0)}`)}
        {box("Total — all channels", rm(total), delta === null ? `last month ${rm(lastTotal)}` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`)}
      </div>
      {/* v1.6.1: last month's KPI result stays as context; the editable KPI
          target itself now lives on the Dashboard's Sales Floor. */}
      {rev.last_target_cents ? (() => {
        const lastPct = Math.round((lastTotal / rev.last_target_cents!) * 100);
        const hit = lastPct >= 100;
        return (
          <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${hit ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {hit ? "🏆" : "📈"} Last month ({ym(rev.last_month)}): {rm(lastTotal)} of {rm(rev.last_target_cents!)} — {lastPct}%{" "}
            {hit ? "TARGET HIT — keep the streak going!" : "— this month is the comeback."}
          </p>
        );
      })() : null}
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

const EVENTS_MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"];
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
  const [draft, setDraft] = useState({ title: "", category: "training", event_date: "", start_time: "", end_time: "", location: "", details: "" });
  // v1.4.76: professional month-calendar view (default) with a list toggle.
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [calMonth, setCalMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const canManage = EVENTS_MANAGE_ROLES.includes(role);
  const { show: showToast, node: toastNode } = useSaveToast();

  // v1.4.81: Johor public holidays render on the calendar too.
  const [holidays, setHolidays] = useState<{ holiday_date: string; name: string; kind: string }[]>([]);
  // v1.4.101: staff birthdays render on the calendar + upcoming list — the
  // team sees them coming and can prepare the celebration.
  const [bdays, setBdays] = useState<{ name: string; birthday: string }[]>([]);
  useEffect(() => {
    void api<{ birthdays: { name: string; birthday: string }[] }>(`/staff/birthdays-lite`)
      .then((r) => { if (r.ok && r.data) setBdays(r.data.birthdays); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const bdayOn = (iso: string) => bdays.filter((b) => b.birthday?.slice(5) === iso.slice(5));

  const loadEvents = useCallback(async () => {
    const res = await api<{ events: CompanyEvent[] }>(`/staff/events`);
    if (res.ok && res.data) setEvents(res.data.events);
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    void api<{ holidays: { holiday_date: string; name: string; kind: string }[] }>(
      `/staff/holidays?year=${calMonth.slice(0, 4)}`,
    ).then((r) => { if (r.ok && r.data) setHolidays(r.data.holidays); });
  }, [calMonth]);

  const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.event_date >= todayISO);
  // birthdays in the next 30 days, projected onto this/next year
  const upcomingBdays = bdays.map((b) => {
    const md = b.birthday.slice(5);
    let iso = `${todayISO.slice(0, 4)}-${md}`;
    if (iso < todayISO) iso = `${Number(todayISO.slice(0, 4)) + 1}-${md}`;
    return { name: b.name, iso };
  }).filter((b) => (new Date(b.iso).getTime() - new Date(todayISO).getTime()) / 86400000 <= 30)
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const daysAway = (iso: string) => {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const n = Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86400000);
    return n === 0 ? "TODAY" : n === 1 ? "Tomorrow" : `in ${n} days`;
  };

  const createEvent = async () => {
    if (!draft.title.trim() || !draft.event_date) { setMsg("Title and date are required."); return; }
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(`/staff/events`, {
      method: "POST",
      body: JSON.stringify({ ...draft, start_time: draft.start_time || undefined, end_time: draft.end_time || undefined, location: draft.location || undefined, details: draft.details || undefined }),
    });
    if (!res.ok) { setMsg(res.data?.error?.message ?? "Could not create the event"); return; }
    setDraft({ title: "", category: "training", event_date: "", start_time: "", end_time: "", location: "", details: "" });
    setShowForm(false);
    showToast("Saved", "Event created — all staff notified");
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
            Upcoming events
            {upcoming.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {upcoming.length}
              </span>
            )}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">Trainings, classes and important company dates — everyone is notified when one is added.</p>
        </div>
        <span className="flex items-center gap-2">
          <span className="border-border inline-flex overflow-hidden rounded-lg border text-xs">
            {(["calendar", "list"] as const).map((v) => (
              <button key={v} type="button"
                className={`px-3 py-1.5 font-medium capitalize ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
                onClick={() => setView(v)}>
                {v}
              </button>
            ))}
          </span>
          {canManage && (
            <button type="button" className={btnGhost} onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "+ Add event"}
            </button>
          )}
        </span>
      </div>
      {canManage && showForm && (
        <div className="border-border mt-3 space-y-2 rounded-lg border p-3">
          <Sub t="Event title">
          <input className={inputClass} placeholder="e.g. TikTok Live hosting training" value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></Sub>
          {/* v1.4.154: standard widths — 2-up grid on phones, capped row from sm: */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Sub t="Category">
              <select className={`${inputClass} sm:max-w-40`} value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                {EVENT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Sub>
            <Sub t="Date">
              <input type="date" className={`${inputClass} sm:max-w-44`} value={draft.event_date}
                onChange={(e) => setDraft((d) => ({ ...d, event_date: e.target.value }))} />
            </Sub>
            <Sub t="Start (optional)">
              <input type="time" className={`${inputClass} sm:max-w-32`} value={draft.start_time}
                onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} />
            </Sub>
            <Sub t="End (optional)">
              <input type="time" className={`${inputClass} sm:max-w-32`} value={draft.end_time}
                onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} />
            </Sub>
          </div>
          <Sub t="Location (optional)">
          <input className={inputClass} placeholder="e.g. HQ meeting room / Google Meet" value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} /></Sub>
          <Sub t="Details (optional)">
          <textarea className={`${inputClass} min-h-16`} placeholder="Agenda, links, what to prepare" value={draft.details}
            onChange={(e) => setDraft((d) => ({ ...d, details: e.target.value }))} /></Sub>
          {msg && <p className="text-destructive text-xs font-medium">{msg}</p>}
          <button type="button" className={btnClass} onClick={() => void createEvent()}>Save event — notifies all staff</button>
        </div>
      )}
      {upcomingBdays.length > 0 && (
        <p className="mt-2 rounded-lg bg-pink-50 px-3 py-2 text-xs font-medium text-pink-800">
          🎂 Coming up: {upcomingBdays.slice(0, 4).map((b) => `${firstName(b.name)} (${dmy(b.iso)})`).join(" · ")}
          {upcomingBdays.length > 4 ? ` +${upcomingBdays.length - 4} more` : ""} — time to plan the celebration!
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
          onAdded={(title, how) => showToast(how === "opened" ? "Calendar opened" : how === "stale" ? "Server needs the update" : "Saved",
            how === "opened"
              ? `${title} — tap Add All (iPhone) or Save (Android) on the page that just opened`
              : how === "stale"
                ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                : how === "shared"
                  ? `${title} — pick Calendar in the share sheet to finish`
                  : `${title} — calendar file downloaded; open it to add the event`)}
        />
      )}
      {view === "list" && (
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
        {upcoming.length === 0 && <p className="text-muted-foreground text-sm">No upcoming events scheduled.</p>}
        {upcoming.map((ev) => (
          <div key={ev.id} className="border-border flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium">{ev.title}</span>{" "}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{ev.category}</span>
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {dmy(ev.event_date)}
                <span className={`ml-1.5 font-semibold ${daysAway(ev.event_date) === "TODAY" ? "text-amber-700" : ""}`}>· {daysAway(ev.event_date)}</span>
                {ev.start_time ? ` · ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : ""}
                {ev.location ? ` · ${ev.location}` : ""}
              </p>
              {ev.details && <p className="text-muted-foreground mt-0.5 text-xs">{ev.details}</p>}
              {ev.created_by_name && <p className="text-muted-foreground mt-0.5 text-[11px]">Added by {ev.created_by_name}</p>}
            </div>
            <span className={rowActions}>
              {/* v1.4.264: the portal card can only remind people while they
                  are LOOKING at it — the phone's own calendar is what buzzes
                  on the day. Every staff member gets this, not just managers. */}
              <button type="button" className={rowBtn}
                title="Save this event into your phone's calendar — it carries a reminder the evening before and at the start"
                onClick={async () => {
                  const how = await addEventToCalendar(ev);
                  showToast(how === "opened" ? "Calendar opened" : how === "stale" ? "Server needs the update" : "Saved",
                    how === "opened"
                      ? `${ev.title} — tap Add All (iPhone) or Save (Android) on the page that just opened`
                      : how === "stale"
                        ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                        : how === "shared"
                          ? `${ev.title} — pick Calendar in the share sheet to finish`
                          : `${ev.title} — calendar file downloaded; open it to add the event`, how === "stale" ? "notice" : undefined);
                }}>📅 Add to my calendar</button>
              {canManage && (
                <button type="button" className={rowBtnDanger} onClick={() => void removeEvent(ev.id)}>Remove</button>
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
function EventsCalendar({ events, holidays, birthdays = [], month, onMonth, selected, onSelect, canManage, onRemove, onAdded }: {
  events: CompanyEvent[];
  holidays: { holiday_date: string; name: string; kind: string }[];
  birthdays?: { name: string; birthday: string }[];
  month: string;
  onMonth: (m: string) => void;
  selected: string | null;
  onSelect: (d: string | null) => void;
  canManage: boolean;
  onRemove: (id: number) => void;
  onAdded: (title: string, how: "opened" | "shared" | "downloaded" | "stale") => void;
}) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const byDay = (d: string) => events.filter((e) => e.event_date === d);
  const holidayOf = (d: string) => holidays.find((h) => h.holiday_date === d);
  const bdaysOf = (d: string) => birthdays.filter((b) => b.birthday?.slice(5) === d.slice(5)); // month-day match, any year
  const shift = (delta: number) => {
    onSelect(null);
    onMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  };
  const monthLabel = first.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const dayEvents = selected ? byDay(selected) : [];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous month" className="border-border inline-flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-secondary" onClick={() => shift(-1)}>‹</button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <button type="button" aria-label="Next month" className="border-border inline-flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-secondary" onClick={() => shift(1)}>›</button>
      </div>
      <div className="text-muted-foreground mt-2 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide uppercase">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="border-border grid grid-cols-7 overflow-hidden rounded-lg border">
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} className="border-border bg-secondary/20 min-h-12 border-r border-b last:border-r-0 md:min-h-20" />;
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
              className={`border-border relative min-h-12 border-r border-b p-1 text-left align-top transition-colors last:border-r-0 md:min-h-20 md:p-1.5 ${isSel ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] md:text-xs ${isToday ? "bg-primary text-primary-foreground font-bold" : hol ? "font-bold text-red-600" : "font-medium"}`}>{d}</span>
              {hol && (
                <>
                  <span className="mt-0.5 flex md:hidden"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /></span>
                  <span className="mt-0.5 hidden truncate rounded bg-red-50 px-1 py-0.5 text-[10px] leading-tight font-medium text-red-700 md:block" title={hol.name}>
                    {hol.name}
                  </span>
                </>
              )}
              {bdaysOf(dISO).length > 0 && (
                <>
                  <span className="mt-0.5 flex md:hidden"><span className="h-1.5 w-1.5 rounded-full bg-pink-500" /></span>
                  <span className="mt-0.5 hidden truncate rounded bg-pink-50 px-1 py-0.5 text-[10px] leading-tight font-medium text-pink-700 md:block" title={bdaysOf(dISO).map((b) => b.name).join(", ")}>
                    🎂 {firstName(bdaysOf(dISO)[0]!.name)}{bdaysOf(dISO).length > 1 ? ` +${bdaysOf(dISO).length - 1}` : ""}
                  </span>
                </>
              )}
              {/* Mobile: dots. Desktop: title snippets. */}
              {evs.length > 0 && (
                <>
                  <span className="mt-0.5 flex flex-wrap gap-0.5 md:hidden">
                    {evs.slice(0, 4).map((e) => <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS[e.category] ?? "bg-primary"}`} />)}
                  </span>
                  <span className="mt-0.5 hidden md:block">
                    {evs.slice(0, 2).map((e) => (
                      <span key={e.id} className="mb-0.5 block truncate rounded bg-secondary px-1 py-0.5 text-[10px] leading-tight">
                        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${EVENT_COLORS[e.category] ?? "bg-primary"}`} />
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 2 && <span className="text-muted-foreground block text-[10px]">+{evs.length - 2} more</span>}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-[11px]">
        {Object.entries(EVENT_COLORS).map(([k, cls]) => (
          <span key={k} className="inline-flex items-center gap-1 capitalize"><span className={`h-2 w-2 rounded-full ${cls}`} />{k}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />Public holiday</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-500" />🎂 Birthday</span>
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
              <span key={b.name} className="ml-2 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700">
                🎂 {properName(b.name)}&apos;s birthday
              </span>
            ))}
          </p>
          {dayEvents.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">{holidayOf(selected) ? "Public holiday — no company events." : "No events this day."}</p>
          ) : (
            dayEvents.map((ev) => (
              <div key={ev.id} className="mt-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${EVENT_COLORS[ev.category] ?? "bg-primary"}`} />
                    <span className="font-medium">{ev.title}</span>{" "}
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{ev.category}</span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day"}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.created_by_name ? ` · added by ${ev.created_by_name}` : ""}
                  </p>
                  {ev.details && <p className="text-muted-foreground mt-0.5 text-xs">{ev.details}</p>}
                </div>
                <span className={rowActions}>
                  {/* v1.4.264: same button as the list view — one tap into the
                      phone's own calendar, for every staff member. */}
                  <button type="button" className={rowBtn}
                    title="Save this event into your phone's calendar — it carries a reminder the evening before and at the start"
                    onClick={async () => {
                      const how = await addEventToCalendar(ev);
                      onAdded(ev.title, how);
                    }}>📅 Add to my calendar</button>
                  {canManage && (
                    <button type="button" className={rowBtnDanger} onClick={() => onRemove(ev.id)}>Remove</button>
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
  const [month, setMonth] = useState(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7));
  const [records, setRecords] = useState<{ type: string; created_at: string; name?: string }[]>([]);
  const [reportMode, setReportMode] = useState(false);
  // v1.4.80: click a column header to sort; click again to reverse.
  const [sortKey, setSortKey] = useState<"name" | "type" | "time" | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const clickSort = (k: "name" | "type" | "time") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };
  // v1.4.78: report can focus on one staff member.
  const [filterName, setFilterName] = useState("");
  const canReport = MANAGE_ROLES.includes(user.role);
  // v1.4.173 (CEO): today's monitor — who has NOT clocked in / out.
  const [monitor, setMonitor] = useState<{ date: string; staff: { id: number; name: string; role: string; employment_status?: string | null; in_at?: string | null; out_at?: string | null }[] } | null>(null);

  useEffect(() => {
    const path = reportMode && canReport ? `/staff/attendance/report?month=${month}` : `/staff/attendance?month=${month}`;
    void api<{ records: typeof records }>(path).then((r) => setRecords(r.data?.records ?? []));
  }, [month, reportMode, canReport]);
  useEffect(() => {
    if (!canReport) return;
    const loadMon = () => void api<NonNullable<typeof monitor>>(`/staff/attendance/monitor`).then((r) => { if (r.ok && r.data) setMonitor(r.data); });
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
      {canReport && monitor && (() => {
        const hm = (iso?: string | null) => {
          if (!iso) return null;
          const d = new Date(new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000);
          return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        };
        const nowMYT = new Date(Date.now() + 8 * 3600 * 1000);
        const isWeekend = [0, 6].includes(nowMYT.getUTCDay());
        const afterShift = nowMYT.getUTCHours() >= 18;
        const notIn = monitor.staff.filter((s) => !s.in_at);
        const stillIn = monitor.staff.filter((s) => s.in_at && !s.out_at);
        return (
          <div className={card}>
            <p className="text-sm font-semibold">👁 Today&apos;s attendance monitor — {dmy(monitor.date)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Live snapshot of every active staff member&apos;s punches today (refreshes every 2 minutes).
              {isWeekend ? " Weekend — missing punches are normal." : ""}
            </p>
            {notIn.length > 0 && !isWeekend && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                ⚠ Not clocked in: {notIn.map((s) => firstName(s.name)).join(", ")}
              </p>
            )}
            {stillIn.length > 0 && afterShift && (
              <p className="mt-2 rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-900">
                ⏳ Past 18:00 with no clock-out yet: {stillIn.map((s) => firstName(s.name)).join(", ")}
              </p>
            )}
            {/* v1.4.196 (CEO): summary callouts stay; the full per-staff
                list hides behind one click — minimalist view */}
            <DetailsToggle label="Staff list">
            <div className="border-border divide-border mt-1 max-h-64 divide-y overflow-y-auto rounded-lg border">
              {[...monitor.staff].sort((a, b) => Number(!!a.in_at) - Number(!!b.in_at) || a.name.localeCompare(b.name)).map((st) => (
                <div key={st.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{properName(st.name)}</span>
                    <span className="text-muted-foreground text-xs capitalize"> · {st.role.replace(/_/g, " ")}{st.employment_status === "part_time" ? " (part-time)" : ""}</span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1">
                    {st.in_at
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">In {hm(st.in_at)}</span>
                      : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">⚠ not clocked in</span>}
                    {st.in_at && (st.out_at
                      ? <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">Out {hm(st.out_at)}</span>
                      : <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${afterShift ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{afterShift ? "⏳ no clock-out" : "still in"}</span>)}
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
              {reportMode && canReport ? "Team attendance report" : "My attendance"}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {reportMode && canReport
                ? "Every punch across the team for the chosen month. Times are Malaysia time."
                : "Your days at work with hours counted — first clock-in to last clock-out. Times are Malaysia time."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reportMode && canReport && records.length > 0 && (
              <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-44" value={filterName}
                title="Show one staff member only"
                onChange={(e) => setFilterName(e.target.value)}>
                <option value="">Find staff: everyone</option>
                {[...new Set(records.map((r) => r.name).filter(Boolean))].sort().map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}

            <input type="month" className="border-input bg-background h-9 rounded-lg border px-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
            {canReport && (
              <button type="button" className={btnGhost} onClick={() => setReportMode((v) => !v)}>
                {reportMode ? "My attendance" : "Team report"}
              </button>
            )}
          </div>
        </div>

        {records.length === 0 && <p className="text-muted-foreground mt-3 text-sm">No records for this month.</p>}

        {/* Personal view (v1.4.77): grouped by day — Date | In | Out | Hours. */}
        {!reportMode && records.length > 0 && (() => {
          const byDay = new Map<string, { ins: string[]; outs: string[] }>();
          for (const r of records) {
            const d = mytDateOf(r.created_at);
            const g = byDay.get(d) ?? { ins: [], outs: [] };
            (r.type === "clock_in" ? g.ins : g.outs).push(r.created_at);
            byDay.set(d, g);
          }
          const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
          const hoursOf = (firstIn?: string, lastOut?: string) => {
            if (!firstIn || !lastOut) return null;
            const ms = new Date(lastOut.replace(" ", "T") + "Z").getTime() - new Date(firstIn.replace(" ", "T") + "Z").getTime();
            if (ms <= 0) return null;
            const h = Math.floor(ms / 3600000);
            const m = Math.round((ms % 3600000) / 60000);
            return `${h}h ${String(m).padStart(2, "0")}m`;
          };
          const totalMs = days.reduce((sum, [, g]) => {
            const fi = g.ins.sort()[0];
            const lo = g.outs.sort().at(-1);
            if (!fi || !lo) return sum;
            const ms = new Date(lo.replace(" ", "T") + "Z").getTime() - new Date(fi.replace(" ", "T") + "Z").getTime();
            return ms > 0 ? sum + ms : sum;
          }, 0);
          return (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Date</th>
                    <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">In</th>
                    <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">Out</th>
                    <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(([d, g]) => {
                    const firstIn = g.ins.sort()[0];
                    const lastOut = g.outs.sort().at(-1);
                    const hrs = hoursOf(firstIn, lastOut);
                    return (
                      <tr key={d} className="border-border border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{dmy(d)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {firstIn ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{mytTime(firstIn)}</span> : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {lastOut ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{mytTime(lastOut)}</span> : firstIn ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">still in</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">missing</span>}
                        </td>
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{hrs ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-border border-t-2 font-semibold">
                    <td className="px-2 py-2">{days.length} day{days.length === 1 ? "" : "s"}</td>
                    <td className="px-2 py-2" colSpan={2}></td>
                    <td className="px-2 py-2 whitespace-nowrap">{totalMs > 0 ? `${Math.floor(totalMs / 3600000)}h ${String(Math.round((totalMs % 3600000) / 60000)).padStart(2, "0")}m` : "—"}</td>
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
                  {([["name", "Staff"], ["type", "Type"], ["time", "Time (MYT)"]] as const).map(([k, label]) => (
                    <th key={k}
                      className="text-muted-foreground cursor-pointer px-2 py-2 text-left text-xs font-semibold uppercase select-none hover:underline"
                      title="Click to sort — click again to reverse"
                      onClick={() => clickSort(k)}>
                      {label}{sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const visible = filterName ? records.filter((r) => r.name === filterName) : records;
                  if (!sortKey) return visible;
                  const val = (r: (typeof records)[number]) =>
                    sortKey === "name" ? (r.name ?? "") : sortKey === "type" ? r.type : r.created_at;
                  return [...visible].sort(
                    (a, b) => (val(a).localeCompare(val(b)) || a.created_at.localeCompare(b.created_at)) * sortDir,
                  );
                })().map((r, i) => (
                  <tr key={i} className="border-border border-b last:border-0">
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.name ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.type === "clock_in" ? "bg-green-100 text-green-800" : "bg-secondary"}`}>
                        {r.type === "clock_in" ? "In" : "Out"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{mytDateTime(r.created_at)}</td>
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

const LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"] as const;

const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR review",
  hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO",
  pending_final: "Awaiting CEO",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Which stage a reviewer role can act on (mirrors the Worker's chain).
function canActOnStage(role: string, stage: string, applicantRole: string): boolean {
  const HR = ["super_admin", "admin", "hr_admin"];
  const PRE = ["super_admin", "admin", "coo", "cco"];
  const FIN = ["super_admin", "admin", "ceo"];
  if (stage === "applied") return HR.includes(role);
  if (stage === "hr_reviewed")
    return applicantRole === "coo" || applicantRole === "cco" ? FIN.includes(role) : PRE.includes(role);
  if (stage === "pre_approved" || stage === "pending_final") return FIN.includes(role);
  return false;
}

/* v1.4.134: printable Leave Application Form — AZOO-HR-LVE-001, same flow
   and layout language as the claim form: employee e-signature + submission
   date, pre-approver name/signature/date, CEO full name + signature + date
   on approval, MYT everywhere, footer pinned to the A4 bottom, one page. */
/** v1.4.139: subhead label above placeholder fields (portal-wide pattern). */
function Sub({ t, children, className = "" }: { t: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{t}</span>
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
  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
  const myt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    if (iso.length <= 10) return dmy(iso);
    const d = new Date(new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000);
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
    ceo: "ceo-sign.png", coo: "coo-sign.png", cco: "cco-sign.png",
    hr_admin: "hr-admin-sign.png", sales_marketing: "sales-marketing-sign.png",
  };
  const empSig = SIG_FILE[l.applicant_role ?? ""] ?? null;
  const statusLine =
    stage === "approved" ? `APPROVED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.final_at ? " on " + myt(l.final_at) + " MYT" : ""}`
    : stage === "rejected" ? `REJECTED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.review_comment ? " · Note: " + l.review_comment : ""}`
    : stage === "cancelled" ? "CANCELLED BY APPLICANT"
    : `PENDING — ${stage === "applied" ? "awaiting HR review" : stage === "hr_reviewed" ? "HR ✓ — awaiting pre-approval" : "pre-approved — awaiting CEO"}`;
  const chainNotes = [
    l.hr_by_name ? `HR reviewed by ${l.hr_by_name}${l.hr_at ? " on " + myt(l.hr_at) + " MYT" : ""}` : "",
    l.preapp_by_name ? `Pre-approved by ${l.preapp_by_name}${l.preapp_at ? " on " + myt(l.preapp_at) + " MYT" : ""}` : "",
  ].filter(Boolean).join(" · ");
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
  <h1>AZ ONE OFFICIAL<small>LIVE · CONNECT · GROW</small></h1>
  <h2>Leave Application Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">AZOO-HR-LVE-001</td><td class="k">Version</td><td class="v">001</td></tr>
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
        <div class="sg">Signature:${empSig
          ? `<img class="sigimg" src="/signatures/${empSig}" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
          : ` <span class="esig">${l.user_full || l.user_name || meName || ""}</span><span class="esub">(submitted in system)</span>`}</div>
        <div class="dt">Date: ${myt(cA)}${cA.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${l.preapp_by_full || l.preapp_by_name
        ? `<div class="nm">Name: ${(l.preapp_by_full || l.preapp_by_name || "").toUpperCase()}</div>
           <div class="sg">Signature:<img class="sigimg" src="/signatures/${l.preapp_by_role === "coo" ? "coo" : "cco"}-sign.png" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${l.preapp_at ? myt(l.preapp_at) + " MYT" : ""}</div>`
        : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`}</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${stage === "approved" ? (l.final_by_full || l.final_by_name || "").toUpperCase() : ""}</div>
        <div class="sg">Signature:${stage === "approved" ? `<img class="sigimg" src="/signatures/ceo-sign.png" alt="" onerror="this.style.display='none'"/>` : ""}</div>
        <div class="dt">Date: ${stage === "approved" && l.final_at ? myt(l.final_at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  <p class="foot">AZ ONE OFFICIAL · SSM 202603168673 (JM1046169-H) · 34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor · This form accompanies the system record ${lvNo}; the in-system decision is authoritative.</p>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`);
  w.document.close();
}

/* v1.4.249: the same number the printed form and the PDF carry, so a row, a
   printout and a shared file all name the record identically. */
function leaveNoOf(l: { created_at?: string | null; day_seq?: number | null; id: number }) {
  const dd = (l.created_at ?? "").slice(0, 10);
  return `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
}

function Leave({ user }: { user: User }) {
  const [openLeave, setOpenLeave] = useState<number | null>(null);
  const [balances, setBalances] = useState<Record<string, { entitled: number; used: number; accrued?: number }>>({});
  const [mine, setMine] = useState<LeaveReq[]>([]);
  const [all, setAll] = useState<LeaveReq[]>([]);
  const [draft, setDraft] = useState({ type: "annual", start_date: "", end_date: "", days: 1, reason: "" });
  const canApprove = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"].includes(user.role);

  const load = useCallback(async () => {
    const b = await api<{ balances: typeof balances }>(`/staff/leave/balance`);
    setBalances(b.data?.balances ?? {});
    const m = await api<{ leave: LeaveReq[] }>(`/staff/leave`);
    setMine(m.data?.leave ?? []);
    if (canApprove) {
      const a = await api<{ leave: LeaveReq[] }>(`/staff/leave?all=1`);
      setAll(
        (a.data?.leave ?? []).filter(
          (x) => canActOnStage(user.role, (x as LeaveReq).stage ?? "", (x as LeaveReq).applicant_role ?? "") && (x as { user_id?: number }).user_id !== user.id,
        ),
      );
    }
  }, [canApprove, user.role, user.id]);
  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    if (!draft.start_date || !draft.end_date || draft.days <= 0) return;
    await api(`/staff/leave`, { method: "POST", body: JSON.stringify(draft) });
    setDraft({ type: "annual", start_date: "", end_date: "", days: 1, reason: "" });
    void load();
  };
  const act = async (id: number, action: string, comment = "") => {
    await api(`/staff/leave/${id}`, { method: "PATCH", body: JSON.stringify({ action, comment }) });
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
              <p className="text-xs font-medium uppercase tracking-wide">{t}</p>
              <p className="mt-1 text-lg font-semibold">
                {availableNow}
                <span className="text-muted-foreground text-xs font-normal"> eligible now</span>
              </p>
              <p className="text-muted-foreground text-[11px]">
                {b.entitled}/year · {b.used} used
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Apply for leave</p>
          <div className="mt-3 space-y-3">
            <Sub t="Leave type">
              <select className={inputClass} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
                {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Sub>
            <div className="grid grid-cols-2 gap-3">
              <Sub t="Start date">
                <input type="date" className={inputClass} value={draft.start_date} onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))} />
              </Sub>
              <Sub t="End date">
                <input type="date" className={inputClass} value={draft.end_date} onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))} />
              </Sub>
            </div>
            <Sub t="Days (0.5 = half day)">
              <input type="number" min={0.5} step={0.5} className={inputClass} value={draft.days} onChange={(e) => setDraft((d) => ({ ...d, days: Number(e.target.value) }))} />
            </Sub>
            <Sub t="Reason (optional)">
              <textarea className={inputClass} rows={2} placeholder="e.g. Family matters in Melaka" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
            </Sub>
            <button type="button" className={btnClass} onClick={() => void apply()}>Submit request</button>
          </div>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">My leave history</p>
          {mine.length === 0 && <p className="text-muted-foreground mt-2 text-sm">No requests yet.</p>}
          <div className="max-h-72 overflow-y-auto">
          {mine.map((l) => (
            <div key={l.id} className="border-border border-b py-2 text-sm last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                {/* v1.4.249: the leave number opens the record; type, period,
                    reason and the reviewer's comment moved into the panel. */}
                <RecordToggle open={openLeave === l.id} title="Type, period, reason and comments"
                  onToggle={() => setOpenLeave(openLeave === l.id ? null : l.id)}>{leaveNoOf(l)}</RecordToggle>
                {" · "}{l.days}d ·{" "}
                <span className="font-medium">{STAGE_LABEL[(l as LeaveReq).stage ?? l.status] ?? l.status}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className={rowBtn} title="Print the Leave Application Form (AZOO-HR-LVE-001)" onClick={() => printLeaveForm(l, user.name)}>Print form</button>
                {/* v1.4.246: the same form as a real PDF file, into the share sheet. */}
                <button type="button" className={rowBtn} title="Send the leave form as a PDF file"
                  onClick={() => void sendLeavePdf(l)}>Send PDF</button>
                {!["approved", "rejected", "cancelled"].includes((l as LeaveReq).stage ?? "") && (
                  <button type="button" className={rowBtnDanger} onClick={() => void act(l.id, "cancel")}>Cancel</button>
                )}
              </span>
            </div>
            {openLeave === l.id && (
              <DetailGrid items={[
                { label: "Type", value: l.type },
                { label: "Period", value: `${dmy(l.start_date)} → ${dmy(l.end_date)}` },
                { label: "Days", value: `${l.days}` },
                { label: "Reason", wide: true, value: l.reason ?? "" },
                { label: "Reviewer note", wide: true, value: l.review_comment ?? "" },
              ]} />
            )}
            </div>
          ))}
          </div>
        </div>
      </div>

      {canApprove && (
        <div className={card}>
          <p className="text-sm font-semibold">Leave awaiting my action</p>
          {all.length === 0 && <p className="text-muted-foreground mt-2 text-sm">Nothing awaiting you.</p>}
          <div className="max-h-72 overflow-y-auto">
          {all.map((l) => (
            <div key={l.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
              <span>
                <span className="font-medium">{l.user_name}</span> · {l.type} · {dmy(l.start_date)} → {dmy(l.end_date)} ({l.days}d)
                <span className="text-muted-foreground"> · {STAGE_LABEL[(l as LeaveReq).stage ?? ""] ?? ""}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => void act(l.id, "approve")}>
                  {((l as LeaveReq).stage === "applied") ? "Mark reviewed" : ((l as LeaveReq).stage === "hr_reviewed" ? "Pre-approve" : "Final approve")}
                </button>
                <button type="button" className="text-destructive text-sm underline" onClick={() => void act(l.id, "reject")}>Reject</button>
              </span>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Tasks ================= */

function Tasks({ user }: { user: User }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState({ title: "", description: "", assigned_to: 0, priority: "normal", deadline: "" });
  const canManage = MANAGE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    const r = await api<{ tasks: Task[] }>(`/staff/tasks${canManage ? "?all=1" : ""}`);
    setTasks(r.data?.tasks ?? []);
    if (canManage) {
      const u = await api<{ users: { id: number; name: string }[] }>(`/staff/users`);
      setTeam(u.data?.users ?? []);
    }
  }, [canManage]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!draft.title) return;
    // Staff self-assign; managers may pick someone. 0 = self on the server.
    const payload = { ...draft, assigned_to: draft.assigned_to || undefined };
    await api(`/staff/tasks`, { method: "POST", body: JSON.stringify(payload) });
    setDraft({ title: "", description: "", assigned_to: 0, priority: "normal", deadline: "" });
    void load();
  };
  const update = async (id: number, patch: Record<string, unknown>) => {
    await api(`/staff/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    void load();
  };

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      <div className={card}>
        <p className="text-sm font-semibold">{canManage ? "Create / assign a task" : "Create a task"}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          You know your work best — add your own tasks with a deadline and track
          them as open, pending, or closed.
        </p>
        <div className="mt-3 space-y-3">
          <Sub t="Title">
            <input className={inputClass} placeholder="e.g. Prepare LIVE rundown" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          </Sub>
          <Sub t="Description">
            <textarea className={inputClass} rows={2} placeholder="What needs doing?" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Sub>
          {canManage && (
            <Sub t="Assign to">
              <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: Number(e.target.value) }))}>
                <option value={0}>Assign to myself</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Sub>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Sub t="Priority">
              <select className={inputClass} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Sub>
            <Sub t="Deadline (optional)">
              <input type="date" className={inputClass} value={draft.deadline} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
            </Sub>
          </div>
          <button type="button" className={btnClass} onClick={() => void create()}>Create task</button>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">{canManage ? "All tasks" : "My tasks"}</p>
        {tasks.length === 0 && <p className="text-muted-foreground mt-2 text-sm">No tasks.</p>}
        <div className="max-h-96 overflow-y-auto">
        {tasks.map((t) => (
          <div key={t.id} className="border-border border-b py-2 text-sm last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{t.title}</span>
                {t.assignee ? <span className="text-muted-foreground"> · {t.assignee}</span> : null}
                <span className="text-muted-foreground"> · {t.priority}{t.deadline ? ` · due ${t.deadline}` : ""}</span>
              </span>
              <span className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                  value={t.status}
                  onChange={(e) => void update(t.id, { status: e.target.value, progress: e.target.value === "completed" ? 100 : t.progress })}
                >
                  {[["open", "Open"], ["in_progress", "Pending"], ["completed", "Closed"]].map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                </select>
                <span className="text-muted-foreground text-xs">{t.progress}%</span>
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
const MS_MONTHS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
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
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[*•-]\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]!); return; }
    flush();
    const label = ln.match(/^([A-Za-z][A-Za-z\s()\/&]{1,30}):\s+(.+)$/);
    if (label && !label[2]!.startsWith("//")) {
      out.push(<p key={i}><span className="font-semibold">{label[1]}:</span> {label[2]}</p>);
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
  const [toFrom, setToFrom] = useState({ to: "All the staffs", from: "Management" }); // v1.4.224 defaults per CEO
  /* v1.4.262 (CEO: "subject and perkara is the same thing!"): they were.
     Perkara IS a memo's subject — the form asked for it twice and a careless
     publish could carry two different subjects on one memo. The Subject box
     is the single source; the memo header composes Perkara from it. */
  const [memo, setMemo] = useState({ tarikh: todayMalay() });
  const canPost = MANAGE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    const r = await api<{ announcements: Announcement[] }>(`/staff/announcements`);
    setAnns(r.data?.announcements ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async () => {
    if (!draft.title || !draft.body) return;
    /* v1.4.215: a memo publishes with its header lines composed into the
       body — no schema change, and the feed renders them bold. */
    const isMemo = draft.category === "memo";
    const headerLines = [
      toFrom.to.trim() && `${isMemo ? "Kepada" : "To"}: ${toFrom.to.trim()}`,
      toFrom.from.trim() && `${isMemo ? "Daripada" : "From"}: ${toFrom.from.trim()}`,
      isMemo && memo.tarikh.trim() && `Tarikh: ${memo.tarikh.trim()}`,
      isMemo && draft.title.trim() && `Perkara: ${draft.title.trim()}`,
    ].filter(Boolean);
    const body = headerLines.length > 0 ? headerLines.join("\n") + "\n\n" + draft.body : draft.body;
    await api(`/staff/announcements`, { method: "POST", body: JSON.stringify({ ...draft, body }) });
    setDraft({ title: "", body: "", category: "news" });
    setToFrom({ to: "All the staffs", from: "Management" });
    setMemo({ tarikh: todayMalay() });
    void load();
  };
  const ack = async (id: number) => {
    await api(`/staff/announcements/${id}/ack`, { method: "POST", body: JSON.stringify({}) });
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {canPost && (
        <div className={card}>
          <p className="text-sm font-semibold">Publish news</p>
          {/* v1.4.163 (CEO: "head section is not same as Dashboard"): this
              form predated the subhead standard — description + Sub labels
              added so it matches every other card. */}
          <p className="text-muted-foreground mt-0.5 text-xs">
            Posted to every staff member — it appears on their Dashboard and in
            this feed until they press Acknowledge.
          </p>
          <div className="mt-3 space-y-3">
            {/* v1.4.224 (CEO): order = Category → Subject → To | From → Body. */}
            <Sub t="Category">
              <select className={`${inputClass} sm:max-w-44`} value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                {["news", "meeting", "holiday", "kpi", "training", "memo"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Sub>
            <Sub t={draft.category === "memo" ? "Subject / Perkara" : "Subject"}>
              <input className={inputClass} placeholder="e.g. Perubahan waktu balik bekerja" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </Sub>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* v1.4.223: To/From placement boxes on EVERY post; memo mode
                  relabels to Kepada/Daripada and adds Tarikh + Perkara. */}
              <Sub t={draft.category === "memo" ? "Kepada (To)" : "To"}>
                <input className={inputClass} value={toFrom.to} onChange={(e) => setToFrom((m) => ({ ...m, to: e.target.value }))} />
              </Sub>
              <Sub t={draft.category === "memo" ? "Daripada (From)" : "From"}>
                <input className={inputClass} value={toFrom.from} onChange={(e) => setToFrom((m) => ({ ...m, from: e.target.value }))} />
              </Sub>
              {draft.category === "memo" && (
                <Sub t="Tarikh">
                  <input className={inputClass} value={memo.tarikh} onChange={(e) => setMemo((m) => ({ ...m, tarikh: e.target.value }))} />
                </Sub>
              )}
            </div>
            <Sub t={draft.category === "memo" ? "Kandungan memo" : "Body"}>
              <textarea className={inputClass} rows={draft.category === "memo" ? 8 : 3}
                placeholder={draft.category === "memo"
                  ? "Isi memo — guna * di awal baris untuk senarai bullet, dan 'Label: nilai' untuk baris tebal (cth. Masa: 9:00 pagi)"
                  : "The full announcement text"}
                value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
            </Sub>
            <button type="button" className={btnClass} onClick={() => void post()}>Publish</button>
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
                  New
                </span>
              )}
              {a.title} <span className="text-muted-foreground font-normal">· {a.category} · {dmy(a.created_at)}</span></p>
            {a.acked ? (
              <span className="text-muted-foreground text-xs">Acknowledged ✓</span>
            ) : (
              <button type="button" className={btnGhost} onClick={() => void ack(a.id)}>Acknowledge</button>
            )}
          </div>
          <MemoBody body={a.body} />
        </article>
      ))}
      </div>
      {anns.length === 0 && <p className="text-muted-foreground text-sm">No announcements yet.</p>}
    </div>
  );
}

/* ================= Sales (CRM + documents) ================= */

interface Customer { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; address?: string | null }
interface SalesDoc {
  id: number; doc_type: string; doc_number: string; company: string; total_cents: number;
  payment_status: string | null; delivery_status: string | null; created_at: string;
  converted_from?: number | null; // v1.4.233 — set when this INV came from a QT
  payment_ref?: string | null; paid_at?: string | null; salesperson_name?: string | null;
  customer_id?: number; customer_phone?: string | null;
  kind?: string | null; // v1.4.234
}

/** v1.4.101: printable Statement of Account per customer — same branded
    template family as the QT/DO/INV. Invoices only (paid + outstanding). */
function printSOA(company: string, docs: SalesDoc[]) {
  const invs = docs.filter((d) => d.doc_type === "INV" && d.company === company)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (invs.length === 0) return;
  const rm = fmtRM; // v1.4.272 global
  const total = invs.reduce((a, d) => a + d.total_cents, 0);
  const paid = invs.filter((d) => d.payment_status === "paid").reduce((a, d) => a + d.total_cents, 0);
  const outstanding = total - paid;
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = invs.map((d, i) => `<tr>
    <td class="c">${i + 1}</td><td>${d.doc_number}</td><td class="c">${dmy(d.created_at.slice(0, 10))}</td>
    <td class="c">${d.payment_status === "paid" ? `<span style="color:#15803d;font-weight:700">PAID${d.paid_at ? " " + dmy(d.paid_at.slice(0, 10)) : ""}</span>` : '<span style="color:#b45309;font-weight:700">OUTSTANDING</span>'}</td>
    <td class="r">${rm(d.total_cents)}</td>
    <td class="r">${d.payment_status === "paid" ? "—" : rm(d.total_cents)}</td>
  </tr>`).join("");
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
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
    <div class="brand">AZ ONE OFFICIAL<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small>
      <div class="addr">Live Commerce Agency · SSM 202603168673 (JM1046169-H)<br/>
      34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika,<br/>81200 Johor Bahru, Johor, Malaysia<br/>
      admin@azoneofficial.com · WhatsApp +60 12-383 4821</div>
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
  <div class="pay">Kindly settle the outstanding balance by bank transfer — MAYBANK · AZ ONE OFFICIAL · A/C 5516 2328 7032, quoting the invoice number. Please send the transfer receipt via WhatsApp +60 12-383 4821.</div>
  <div class="foot">AZ ONE OFFICIAL · Empowering Brands Through Live Commerce and Digital Connections · azoneofficial.com<br/>This is a computer-generated statement; no signature is required.</div>
  </body></html>`);
  w.document.close();
}


/** Fetch a full document and open a branded, print-ready PDF window. */
/* v1.4.244: printDoc now only fetches and opens the window — the document
   itself is built by lib/doc-template so the customer's shared link renders
   the identical thing. */
async function printDoc(id: number) {
  const res = await fetch(`/api/v1/staff/docs/${id}`, { credentials: "include" });
  if (!res.ok) return;
  const { doc } = (await res.json()) as { doc: DocFull };
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
/* v1.4.206 (CEO: "remove it Live engagement — TikTok since I cant get the
   API!"): LiveEngagementCard REMOVED entirely. The LIVE analytics scope
   (creator.data.live.read.public) is not grantable to a Shop-seller app —
   confirmed 04-08-2026 via Partner Center (Publish → Unavailable) and the
   shop's consent page (7 Shop scopes only). The worker route
   /api/v1/live-analytics stays dormant and harmless; if TikTok ever grants
   the scope via support ticket, rebuild the card against the Live Room
   Core Stats / GMV Trend / Interactive Trends endpoints (different family
   from the one previously coded). */
function LiveGmvCard() {
  interface Gmv {
    today: { cents: number; orders: number };
    month: { cents: number; orders: number };
    week: { d: string; c: number; n: number }[];
    my_sessions_today: { c: number; n: number } | null;
  }
  const [gmv, setGmv] = useState<Gmv | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    const load = () => void api<Gmv>(`/staff/gmv`).then((r) => {
      if (r.ok && r.data) { setGmv(r.data); setState("ready"); }
      else setState("unavailable");
    });
    load();
    const t = window.setInterval(load, 300_000);
    return () => window.clearInterval(t);
  }, []);
  // v1.4.194: never vanish silently — say what's happening instead.
  if (state !== "ready" || !gmv) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold">🔥 Live GMV — TikTok</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {state === "loading"
            ? "Loading today's live GMV…"
            : "Live GMV needs the latest server — run the worker deploy from the current release, then refresh."}
        </p>
      </div>
    );
  }
  const rm2 = fmtRM; // v1.4.272 global
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">🔥 Live GMV — TikTok</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Gross merchandise value from TikTok orders (returned orders
            excluded), Malaysia time. Updates every 5 minutes and on refresh.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wide text-amber-900 uppercase">Today</p>
          <p className="text-lg font-bold text-amber-900">{rm2(gmv.today.cents)}</p>
          <p className="text-xs text-amber-900">{gmv.today.orders} order{gmv.today.orders === 1 ? "" : "s"}</p>
        </div>
        <div className="bg-secondary rounded-lg px-3 py-2">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">This month</p>
          <p className="text-lg font-bold">{rm2(gmv.month.cents)}</p>
          <p className="text-muted-foreground text-xs">{gmv.month.orders} order{gmv.month.orders === 1 ? "" : "s"}</p>
        </div>
        {gmv.my_sessions_today && (
          <div className="col-span-2 rounded-lg border border-green-300 bg-green-100 px-3 py-2 sm:col-span-1">
            <p className="text-[11px] font-semibold tracking-wide text-green-900 uppercase">During your live today</p>
            <p className="text-lg font-bold text-green-900">{rm2(gmv.my_sessions_today.c)}</p>
            <p className="text-xs text-green-900">{gmv.my_sessions_today.n} order{gmv.my_sessions_today.n === 1 ? "" : "s"} in your session window</p>
          </div>
        )}
      </div>
      {/* v1.4.196 (CEO): detail rows hide behind one click — minimalist view */}
      {gmv.week.length > 0 && (
        <DetailsToggle label="Last 7 days">
          <div className="mt-1 space-y-0">
            {gmv.week.map((w) => (
              <div key={w.d} className="border-border flex items-center justify-between border-b py-1 text-sm last:border-0">
                <span className="text-muted-foreground text-xs">{dmy(w.d)}</span>
                <span className="text-xs">{w.n} order{w.n === 1 ? "" : "s"} · <span className="font-medium">{rm2(w.c)}</span></span>
              </div>
            ))}
          </div>
        </DetailsToggle>
      )}
    </div>
  );
}

/* v1.4.191 OT APPROVALS (CEO gap list): pending day-pairs decided here —
   only approved OT will ever feed payroll. */
function OtApprovalsCard() {
  interface Pend { user_id: number; name: string; d: string; ot_in: string | null; ot_out: string | null }
  const [pending, setPending] = useState<Pend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const { confirm: otConfirm, node: otConfirmNode } = useConfirm();
  const load = async () => {
    const r = await api<{ pending?: Pend[] }>(`/staff/attendance/ot/pending`);
    if (r.ok) setPending(r.data?.pending ?? []);
    setLoaded(true);
  };
  useEffect(() => { void load(); }, []);
  const decide = async (p: Pend, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !(await otConfirm({
      title: "Reject this overtime?",
      message: `${properName(p.name)} — ${dmy(p.d)} ${p.ot_in ?? "?"}–${p.ot_out ?? "?"}. The staff member is notified either way.`,
      confirmLabel: "Reject OT", variant: "danger",
    }))) return;
    await api(`/staff/attendance/ot/decide`, {
      method: "POST",
      body: JSON.stringify({ user_id: p.user_id, date: p.d, decision, note: note[`${p.user_id}:${p.d}`] || undefined }),
    });
    void load();
  };
  if (!loaded || pending.length === 0) return <>{otConfirmNode}</>;
  const dur = (p: Pend) => {
    if (!p.ot_in || !p.ot_out) return "";
    const [h1, m1] = p.ot_in.split(":").map(Number); const [h2, m2] = p.ot_out.split(":").map(Number);
    const mins = (h2! * 60 + m2!) - (h1! * 60 + m1!);
    return mins > 0 ? ` · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : "";
  };
  return (
    <div className={card}>
      {otConfirmNode}
      <p className="text-sm font-semibold">⏱ Overtime approvals</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Completed OT day-pairs awaiting a decision. Only APPROVED overtime
        will count when OT feeds payroll. The staff member is notified of
        every decision.
      </p>
      <div className="mt-3 space-y-0">
        {pending.map((p) => (
          <div key={`${p.user_id}:${p.d}`} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span className="min-w-0">
              <span className="font-medium">{properName(p.name)}</span>{" "}
              <span className="text-muted-foreground text-xs">{dmy(p.d)} · {p.ot_in}–{p.ot_out}{dur(p)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <input className="border-input bg-background w-36 rounded border px-1.5 py-0.5 text-xs" placeholder="Note (optional)"
                value={note[`${p.user_id}:${p.d}`] ?? ""}
                onChange={(e) => setNote((n) => ({ ...n, [`${p.user_id}:${p.d}`]: e.target.value }))} />
              <button type="button" className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs font-medium"
                onClick={() => void decide(p, "approved")}>Approve</button>
              <button type="button" className="text-destructive rounded border border-border px-2 py-0.5 text-xs"
                onClick={() => void decide(p, "rejected")}>Reject</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* v1.4.191 LIVE SESSION ROSTER (CEO gap list): which host, which client,
   which platform, what slot. Managers schedule; hosts see their own and are
   bell-notified on assignment. */
function LiveScheduleCard({ user }: { user: User }) {
  interface Sess { id: number; session_date: string; start_time: string; end_time?: string | null; platform: string; client_company?: string | null; client_name?: string | null; host_user_id: number; host_name: string; notes?: string | null; status: string }
  interface Opt { id: number; name?: string | null; company?: string | null; role?: string }
  const manager = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hosts, setHosts] = useState<Opt[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [draft, setDraft] = useState({ session_date: "", start_time: "", end_time: "", platform: "tiktok", client_id: "", client_name: "", host_user_id: "", notes: "" });
  const load = async () => {
    const r = await api<{ sessions?: Sess[] }>(`/staff/live-sessions`);
    if (r.ok) setSessions(r.data?.sessions ?? []);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    if (manager) {
      void api<{ users?: Opt[] }>(`/staff/users`).then((r) => {
        if (r.ok) setHosts((r.data?.users ?? []).filter((u) => !["customer", "super_admin", "admin"].includes(u.role ?? "")));
      });
      void api<{ customers?: Opt[] }>(`/staff/customers`).then((r) => {
        if (r.ok) setClients((r.data?.customers ?? []).filter((c) => (c.company ?? "") !== "Walk-in Customer"));
      });
    }
  }, [manager]);
  const create = async () => {
    if (!draft.session_date || !draft.start_time || !draft.host_user_id) return;
    await api(`/staff/live-sessions`, {
      method: "POST",
      body: JSON.stringify({
        session_date: draft.session_date, start_time: draft.start_time,
        end_time: draft.end_time || undefined, platform: draft.platform,
        client_id: draft.client_id ? Number(draft.client_id) : undefined,
        client_name: draft.client_name || undefined,
        host_user_id: Number(draft.host_user_id), notes: draft.notes || undefined,
      }),
    });
    setDraft({ session_date: "", start_time: "", end_time: "", platform: "tiktok", client_id: "", client_name: "", host_user_id: "", notes: "" });
    void load();
  };
  const setStatus = async (id: number, status: string) => {
    await api(`/staff/live-sessions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    void load();
  };
  if (!loaded) return null;
  if (!manager && sessions.length === 0) return null;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">📺 Live session schedule</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {manager
          ? "The roster: which host goes live for which client, on which platform, at what slot. Hosts are bell-notified when assigned."
          : "Your upcoming live sessions — you are notified when a new one is assigned to you."}
      </p>
      {manager && (
        <div className="mt-3 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <Sub t="Date"><input type="date" className={inputClass} value={draft.session_date} onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))} /></Sub>
          <Sub t="Start"><input type="time" className={inputClass} value={draft.start_time} onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} /></Sub>
          <Sub t="End (optional)"><input type="time" className={inputClass} value={draft.end_time} onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} /></Sub>
          <Sub t="Platform">
            <select className={inputClass} value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}>
              {["tiktok", "shopee", "other"].map((pf) => <option key={pf} value={pf}>{pf}</option>)}
            </select>
          </Sub>
          <Sub t="Host">
            <select className={inputClass} value={draft.host_user_id} onChange={(e) => setDraft((d) => ({ ...d, host_user_id: e.target.value }))}>
              <option value="">Select host…</option>
              {hosts.map((h) => <option key={h.id} value={h.id}>{properName(h.name ?? "")}</option>)}
            </select>
          </Sub>
          <Sub t="Client">
            <select className={inputClass} value={draft.client_id} onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))}>
              <option value="">— unregistered / see note —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
          </Sub>
          <Sub t="Notes (optional)" className="col-span-2 sm:max-w-64 sm:flex-1">
            <input className={inputClass} placeholder="e.g. Raya campaign, product focus" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </Sub>
          <button type="button" className={`${btnClass} col-span-2 sm:col-span-1`} onClick={() => void create()}>Schedule</button>
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">No sessions scheduled.</p>
      ) : (
        <div className="mt-3 max-h-96 space-y-0 overflow-y-auto pr-1">
          {sessions.map((sn) => (
            <div key={sn.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
              <span className="min-w-0">
                <span className="font-medium">{dmy(sn.session_date)}</span>{" "}
                <span className="text-muted-foreground">{sn.start_time}{sn.end_time ? `–${sn.end_time}` : ""}</span>{" "}
                <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">{sn.platform}</span>{" "}
                <span>{properName(sn.host_name)}</span>
                {(sn.client_company ?? sn.client_name) && <span className="text-muted-foreground text-xs"> · {sn.client_company ?? sn.client_name}</span>}
                {sn.notes && <span className="text-muted-foreground block text-xs">{sn.notes}</span>}
              </span>
              {manager ? (
                <select className="border-input bg-background rounded border px-1.5 py-0.5 text-[11px]" value={sn.status}
                  onChange={(e) => void setStatus(sn.id, e.target.value)}>
                  {["scheduled", "completed", "cancelled"].map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sn.status === "cancelled" ? "bg-red-100 text-red-900" : sn.status === "completed" ? "bg-secondary" : "bg-green-100 text-green-900"}`}>{sn.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* v1.4.191 CLIENT LAYER (CEO gap list): per-client agency view — invoiced /
   paid / quotations / live sessions per client, from the customers registry. */

/* v1.4.273 idea 6 — RM per live hour, per client and per host, this month.
   The one number a live agency should run on: which clients to upsell,
   which hosts are earning. Renders null until the worker route exists. */
function LiveEconomicsCard() {
  interface Econ { month: string; clients: { id: number; company: string; minutes: number; paid_cents: number }[]; hosts: { id: number; name: string; minutes: number; gmv_cents: number }[] }
  const [econ, setEcon] = useState<Econ | null>(null);
  useEffect(() => {
    void api<Econ>(`/staff/clients/live-economics`).then((r) => { if (r.ok && r.data) setEcon(r.data); });
  }, []);
  if (!econ || (econ.clients.length === 0 && econ.hosts.length === 0)) return null;
  const hm = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  const perHour = (cents: number, mins: number) => (mins > 0 ? fmtRM(Math.round((cents * 60) / mins)) : "—");
  return (
    <div className={card}>
      <p className="text-sm font-semibold">⏱💰 Live-hour economics — {ym(econ.month)}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        RM per hour of live this month. Clients: paid invoices ÷ completed session hours.
        Hosts: TikTok GMV landing during their sessions (motivation, not payroll).
      </p>
      {econ.clients.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-border border-b">
              <th className={th}>CLIENT</th><th className={thR2}>HOURS</th><th className={thR2}>PAID</th><th className={thR2}>RM / HOUR</th>
            </tr></thead>
            <tbody>
              {econ.clients.map((c) => (
                <tr key={c.id} className="border-border border-b last:border-0">
                  <td className={td}>{c.company}</td>
                  <td className={tdR2}>{hm(c.minutes)}</td>
                  <td className={tdR2}>{fmtRM(c.paid_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>{perHour(c.paid_cents, c.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {econ.hosts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="text-muted-foreground text-xs font-semibold">Hosts</p>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-border border-b">
              <th className={th}>HOST</th><th className={thR2}>HOURS</th><th className={thR2}>GMV IN-LIVE</th><th className={thR2}>RM / HOUR</th>
            </tr></thead>
            <tbody>
              {econ.hosts.map((h) => (
                <tr key={h.id} className="border-border border-b last:border-0">
                  <td className={td}>{properName(h.name)}</td>
                  <td className={tdR2}>{hm(h.minutes)}</td>
                  <td className={tdR2}>{fmtRM(h.gmv_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>{perHour(h.gmv_cents, h.minutes)}</td>
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
  interface Tier { name: string; price_label: string; points: string[] }
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
  const upd = (i: number, patch: Partial<Tier>) => setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className={card}>
      <p className="text-sm font-semibold">📦 Packages — public rate card</p>
      {toastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        Shown on azoneofficial.com/packages with a WhatsApp button. The page
        stays a contact-us page until you save at least one tier here.
      </p>
      <div className="mt-2 space-y-3">
        {tiers.map((t, i) => (
          <div key={i} className="border-border rounded-lg border p-3">
            <div className={fieldRow}>
              <label className="text-sm"><span className="text-muted-foreground text-xs">Tier name</span>
                <input className={inputClass} placeholder="e.g. Starter" value={t.name} onChange={(e) => upd(i, { name: e.target.value })} /></label>
              <label className="text-sm"><span className="text-muted-foreground text-xs">Price label</span>
                <input className={inputClass} placeholder="e.g. from RM 1,500/month" value={t.price_label} onChange={(e) => upd(i, { price_label: e.target.value })} /></label>
              <button type="button" className="text-xs underline" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>Remove tier</button>
            </div>
            <label className="mt-2 block text-sm"><span className="text-muted-foreground text-xs">What&apos;s included — one point per line</span>
              <textarea className={`${inputClass} min-h-20`} value={t.points.join("\n")}
                onChange={(e) => upd(i, { points: e.target.value.split("\n") })} /></label>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {tiers.length < 6 && (
            <button type="button" className={btnClass} onClick={() => setTiers((ts) => [...ts, { name: "", price_label: "", points: [] }])}>+ Add tier</button>
          )}
          <button type="button" className={btnClass} onClick={async () => {
            const clean = tiers.map((t) => ({ ...t, points: t.points.map((p) => p.trim()).filter(Boolean) })).filter((t) => t.name.trim());
            const r = await api(`/staff/sales/packages`, { method: "POST", body: JSON.stringify({ packages: clean }) });
            if (r.ok) { setTiers(clean); showToast("Saved", clean.length ? `${clean.length} tier${clean.length === 1 ? "" : "s"} live on /packages` : "Rate card cleared — the public page is back to contact-us"); }
            else showToast("Not saved", (r.data as { error?: { message?: string } })?.error?.message ?? "Deploy the latest server first", "notice");
          }}>Save rate card</button>
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
  interface RevLine { key: string; label: string; total_cents: number; months: { month: string; cents: number }[] }
  const [lines, setLines] = useState<RevLine[] | null>(null);
  useEffect(() => {
    void api<{ lines: RevLine[] }>(`/staff/revenue/lines`).then((r) => { if (r.ok && r.data) setLines(r.data.lines); });
  }, []);
  if (!lines || lines.length === 0) return null;
  const grand = lines.reduce((a, l) => a + l.total_cents, 0);
  if (grand === 0) return null;
  const monthSet = new Set<string>();
  for (const l of lines) for (const m of l.months) monthSet.add(m.month);
  const monthsDesc = [...monthSet].sort().reverse();
  const cellOf = (l: RevLine, m: string) => l.months.find((x) => x.month === m)?.cents ?? 0;
  const TONE: Record<string, "navy" | "gold" | "muted"> = { product: "navy", service: "gold" };
  return (
    <div className={card}>
      <p className="text-sm font-semibold">🧩 Business lines — product vs service</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Your two businesses, reported separately. Product = TikTok, Shopee, walk-in and product invoices; service = paid service invoices. Same arithmetic as every other revenue figure.
      </p>
      <div className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0">{l.label.split(" (")[0]}</span>
            <div className="flex-1"><MiniBar pct={(l.total_cents / grand) * 100} tone={TONE[l.key] ?? "muted"} /></div>
            <span className="shrink-0 text-right tabular-nums font-medium">{fmtRM(l.total_cents)}</span>
            <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">{Math.round((l.total_cents / grand) * 100)}%</span>
          </div>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-border border-b">
            <th className={th}>MONTH</th>
            {lines.map((l) => <th key={l.key} className={thR2}>{(l.label.split(" ")[0] || "").toUpperCase()}</th>)}
            <th className={thR2}>TOTAL</th>
          </tr></thead>
          <tbody>
            {monthsDesc.map((m) => {
              const rowTotal = lines.reduce((a, l) => a + cellOf(l, m), 0);
              return (
                <tr key={m} className="border-border border-b last:border-0">
                  <td className={td}>{ym(m)}</td>
                  {lines.map((l) => {
                    const c = cellOf(l, m);
                    return <td key={l.key} className={tdR2}>{c ? fmtRM(c) : "—"}</td>;
                  })}
                  <td className={`${tdR2} font-medium`}>{fmtRM(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <th className={th}>TOTAL</th>
            {lines.map((l) => <th key={l.key} className={thR2}>{fmtRM(l.total_cents)}</th>)}
            <th className={thR2}>{fmtRM(grand)}</th>
          </tr></tfoot>
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
    void api<RevenueData>(`/staff/revenue`).then((r) => { if (r.ok && r.data) setRev(r.data); });
  }, []);
  const months = rev?.overall?.months ?? [];
  if (months.length === 0) return null;
  const best = Math.max(...months.map((m) => m.cents), 1);
  const total = months.reduce((a, m) => a + m.cents, 0);
  const rows = [...months].reverse(); // newest first
  return (
    <div className={card}>
      <p className="text-sm font-semibold">📊 Sales history — month by month</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        All four channels, since day one. The bar measures each month against your best.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-border border-b">
            <th className={th}>MONTH</th><th className={thR2}>SALES</th><th className={thR2}>VS PREV</th><th className={`${th} w-28`}></th>
          </tr></thead>
          <tbody>
            {rows.map((m, i) => {
              const prev = rows[i + 1]; // list is newest-first
              const delta = prev && prev.cents > 0 ? ((m.cents - prev.cents) / prev.cents) * 100 : null;
              return (
                <tr key={m.month} className="border-border border-b last:border-0">
                  <td className={td}>{ym(m.month)}{m.cents >= best - 0.5 ? " 🏆" : ""}</td>
                  <td className={tdR2}>{fmtRM(m.cents)}</td>
                  <td className={`${tdR2} ${delta == null ? "text-muted-foreground" : delta >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {delta == null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`}
                  </td>
                  <td className={td}><MiniBar pct={(m.cents / best) * 100} tone={m.cents >= best - 0.5 ? "green" : "gold"} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <th className={th}>TOTAL</th><th className={thR2}>{fmtRM(total)}</th><th className={thR2}></th><th className={th}></th>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* v1.4.278 — 💹 Profit & loss by month ("…and also expenses"): revenue −
   expenses − payroll − approved claims = the number the business actually
   keeps. Renders null on a worker that predates the route. */
function PnlCard() {
  interface PnlMonth { month: string; revenue_cents: number; expenses_cents: number; payroll_cents: number; claims_cents: number; net_cents: number }
  const [months, setMonths] = useState<PnlMonth[] | null>(null);
  useEffect(() => {
    void api<{ months: PnlMonth[] }>(`/staff/finance/pnl`).then((r) => { if (r.ok && r.data) setMonths(r.data.months); });
  }, []);
  if (!months || months.length === 0) return null;
  const rows = [...months].reverse(); // newest first
  return (
    <div className={card}>
      <p className="text-sm font-semibold">💹 Profit &amp; loss — month by month</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Revenue (all channels) minus expenses, payroll and approved claims — what the business keeps.
        Payroll uses the same net figures as the M2E salary file.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-border border-b">
            <th className={th}>MONTH</th><th className={thR2}>REVENUE</th><th className={thR2}>EXPENSES</th>
            <th className={thR2}>PAYROLL</th><th className={thR2}>CLAIMS</th><th className={thR2}>NET</th>
          </tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.month} className="border-border border-b last:border-0">
                <td className={td}>{ym(m.month)}</td>
                <td className={tdR2}>{fmtRM(m.revenue_cents)}</td>
                <td className={tdR2}>{m.expenses_cents ? fmtRM(m.expenses_cents) : "—"}</td>
                <td className={tdR2}>{m.payroll_cents ? fmtRM(m.payroll_cents) : "—"}</td>
                <td className={tdR2}>{m.claims_cents ? fmtRM(m.claims_cents) : "—"}</td>
                <td className={`${tdR2} font-semibold ${m.net_cents >= 0 ? "text-green-700" : "text-red-600"}`}>{fmtRM(m.net_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* v1.5.0: PipelineInsightsCard removed with the Social tab. */

function ClientsCard() {
  interface Cl { id: number; company: string; name?: string | null; invoices: number; invoiced_cents: number; paid_cents: number; quotations: number }
  const [clients, setClients] = useState<Cl[]>([]);
  const [sessions, setSessions] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const { show: showRlToast, node: rlToastNode } = useSaveToast();
  useEffect(() => {
    void api<{ clients?: Cl[]; sessions?: Record<string, number> }>(`/staff/clients/summary`).then((r) => {
      if (r.ok) { setClients(r.data?.clients ?? []); setSessions(r.data?.sessions ?? {}); }
      setLoaded(true);
    });
  }, []);
  if (!loaded) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold">🤝 Clients</p>
        <div className="mt-4 space-y-3 animate-pulse">
          <div className="h-4 w-3/4 rounded bg-secondary"></div>
          <div className="h-4 w-1/2 rounded bg-secondary"></div>
          <div className="h-4 w-2/3 rounded bg-secondary"></div>
        </div>
      </div>
    );
  }
  if (clients.length === 0) return null;
  const rm2 = fmtRM; // v1.4.272 global (this one even lacked thousand separators)
  return (
    <div className={card}>
      <p className="text-sm font-semibold">🤝 Clients</p>
      {rlToastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        Per-client view from your sales documents and the live roster —
        invoiced, collected, quotations in play and sessions scheduled.
      </p>
      <div className="mt-3 max-h-80 space-y-0 overflow-y-auto pr-1">
        {clients.map((c) => (
          <div key={c.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span className="min-w-0 font-medium">{c.company}</span>
            <span className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-2 text-xs">
              <span title="Invoiced total (all INV)">{rm2(c.invoiced_cents)} invoiced</span>
              <span className="font-medium text-green-700" title="Collected (paid invoices)">{rm2(c.paid_cents)} paid</span>
              <span title="Quotations issued">{c.quotations} QT</span>
              <span title="Live sessions scheduled (not cancelled)">{sessions[String(c.id)] ?? 0} live</span>
              {/* v1.4.273 idea 1: the client report link — a public monthly
                  performance page they can forward to their boss. Retention
                  weapon + our best brochure. */}
              <button type="button" className="underline" title="Copy this client's monthly report link" onClick={async () => {
                const r = await api<{ token?: string }>(`/staff/clients/${c.id}/report-link`, { method: "POST" });
                if (!r.ok || !r.data?.token) { showRlToast("Not available", (r.data as { error?: { message?: string } })?.error?.message ?? "Deploy the latest server + run migration 0067 first", "notice"); return; }
                const url = `${location.origin}/report?t=${r.data.token}`;
                try { await navigator.clipboard.writeText(url); showRlToast("Report link copied", `${c.company} — paste it into WhatsApp`); }
                catch { showRlToast("Report link", url, "notice"); }
              }}>🔗 Report link</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerEnquiriesCard() {
  interface Enq { id: number; name: string; company?: string | null; phone?: string | null; email: string; message: string; category?: string | null; status: string; reply?: string | null; replied_at?: string | null; created_at: string }
  const [enqs, setEnqs] = useState<Enq[]>([]);
  const [loaded, setLoaded] = useState(false);
  const CAT: Record<string, string> = {
    general: "General", package_pricing: "Package & pricing", live_commerce: "Live commerce",
    order_delivery: "Order & delivery", collaboration: "Collaboration",
  };
  const load = async () => {
    try {
      const r = await fetch("/api/v1/enquiries", { credentials: "include" });
      if (r.ok) { const d = (await r.json()) as { enquiries?: Enq[] }; setEnqs(d.enquiries ?? []); }
    } catch { /* card stays empty */ }
    setLoaded(true);
  };
  useEffect(() => { void load(); }, []);
  const setStatus = async (id: number, status: string) => {
    await fetch(`/api/v1/enquiries/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    void load();
  };
  // v1.4.191: in-app reply — the customer reads it on /account.
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const [replyOpen, setReplyOpen] = useState<number | null>(null);
  const sendReply = async (id: number) => {
    const text = (replyDraft[id] ?? "").trim();
    if (!text) return;
    await fetch(`/api/v1/enquiries/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply: text }),
    });
    setReplyOpen(null); setReplyDraft((d) => ({ ...d, [id]: "" }));
    void load();
  };
  if (!loaded) return null;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">📨 Customer enquiries</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Questions from /account customers — you are bell-notified when one
        lands. Answer directly on WhatsApp or email, then set the status.
      </p>
      {enqs.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">No enquiries yet.</p>
      ) : (
        <div className="mt-3 max-h-96 space-y-0 overflow-y-auto pr-1">
          {enqs.map((e) => (
            <div key={e.id} className="border-border border-b py-2 text-sm last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{e.name}</span>
                  {e.company ? <span className="text-muted-foreground text-xs"> · {e.company}</span> : null}
                  {e.category ? <span className="bg-secondary ml-1.5 rounded-full px-2 py-0.5 text-[10px]">{CAT[e.category] ?? e.category}</span> : null}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
                  {e.phone && (
                    <a className="underline" target="_blank" rel="noopener noreferrer"
                      href={`https://wa.me/${e.phone.replace(/[^0-9]/g, "")}`}>WhatsApp</a>
                  )}
                  <a className="underline" href={`mailto:${e.email}`}>Email</a>
                  <select className="border-input bg-background rounded border px-1.5 py-0.5 text-[11px]" value={e.status}
                    onChange={(ev) => void setStatus(e.id, ev.target.value)}>
                    {["new", "contacted", "qualified", "closed"].map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">{e.message}</p>
              {e.reply && (
                <p className="mt-1 rounded border border-green-300 bg-green-100 px-2 py-1 text-xs text-green-900">
                  ↩ Replied{e.replied_at ? ` ${mytDateTime(e.replied_at)} MYT` : ""}: {e.reply}
                </p>
              )}
              {replyOpen === e.id ? (
                <span className="mt-1 flex items-center gap-1.5">
                  <input className="border-input bg-background min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                    placeholder="Write the reply the customer will see on /account…"
                    value={replyDraft[e.id] ?? ""}
                    onChange={(ev) => setReplyDraft((d) => ({ ...d, [e.id]: ev.target.value }))} />
                  <button type="button" className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs font-medium"
                    onClick={() => void sendReply(e.id)}>Send</button>
                  <button type="button" className="text-xs underline" onClick={() => setReplyOpen(null)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="mt-1 text-xs underline"
                  onClick={() => setReplyOpen(e.id)}>{e.reply ? "✎ Update reply" : "↩ Reply in-app"}</button>
              )}
              <p className="text-muted-foreground mt-0.5 text-[10px]">{e.email} · {mytDateTime(e.created_at)} MYT</p>
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
function stockToastLine(s: { deducted: { sku: string; qty: number; stock: number }[]; unmatched: string[]; short: string[] } | null | undefined): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.deducted.length) parts.push(`stock deducted: ${s.deducted.map((d) => `${d.sku} −${d.qty} (now ${d.stock})`).join(", ")}`);
  if (s.unmatched.length) parts.push(`⚠ NOT in inventory, not deducted: ${s.unmatched.join(", ")}`);
  if (s.short.length) parts.push(`⚠ short: ${s.short.join("; ")}`);
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

function Sales({ user }: { user: User }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [cust, setCust] = useState({ company: "", contact_person: "", phone: "", email: "", address: "" });
  const [editingCust, setEditingCust] = useState<{ id: number; company: string } | null>(null); // v1.4.235
  // customer_id: -1 = not chosen · 0 = walk-in/unidentified buyer.
  // salesperson_id: 0 = "me" (worker defaults to the creator).
  const [doc, setDoc] = useState<{
    doc_type: string; customer_id: number; salesperson_id: number; kind: string; items: DocItem[];
    discount_cents: number; tax_percent: number; delivery_cents: number; paid_received: boolean;
    reference: string; delivery_address: string;
  }>({
    doc_type: "QT", customer_id: -1, salesperson_id: 0, kind: "product", items: [{ name: "", qty: 1, unit_price_cents: 0 }],
    discount_cents: 0, tax_percent: 0, delivery_cents: 0, paid_received: false, reference: "", delivery_address: "",
  });
  const [staffList, setStaffList] = useState<{ id: number; name: string; role: string }[]>([]);
  const { show: showToast, node: toastNode } = useSaveToast();

  /* v1.4.273 idea 2: the prospect → quotation handoff. The Social tab wrote
     a prefill into localStorage and jumped here; we either pick the existing
     customer by company name or pre-fill the new-customer form, and stamp
     the reference so the QT says where it came from. */
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem("azone-qt-prefill"); } catch { return; }
    if (!raw) return;
    try { localStorage.removeItem("azone-qt-prefill"); } catch { /* fine */ }
    try {
      const pf = JSON.parse(raw) as { company?: string; contact_person?: string; phone?: string; reference?: string };
      const existing = customers.find((c) => c.company.trim().toLowerCase() === (pf.company ?? "").trim().toLowerCase());
      setDoc((d) => ({ ...d, doc_type: "QT", reference: pf.reference ?? d.reference, customer_id: existing ? existing.id : d.customer_id }));
      if (!existing) setCust((c) => ({ ...c, company: pf.company ?? "", contact_person: pf.contact_person ?? "", phone: pf.phone ?? "" }));
      showToast("Prefilled from prospect", existing
        ? `${existing.company} selected — add the package lines and save the quotation`
        : `Add ${pf.company ?? "the client"} as a customer first, then the quotation form is ready`);
    } catch { /* malformed handoff — ignore */ }
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
  const [editingDoc, setEditingDoc] = useState<{ id: number; doc_number: string } | null>(null);
  const [invItems, setInvItems] = useState<{ name: string; sku: string; unit_price_cents?: number }[]>([]);
  // v1.4.96: aligned with the worker's finance permission — sales_marketing
  // creates QT/DO; invoices are created by finance roles ON THEIR BEHALF via
  // the Sales person dropdown (that's the attribution mechanism).
  const canInvoice = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"].includes(user.role);

  const load = useCallback(async () => {
    const c = await api<{ customers: Customer[] }>(`/staff/customers`);
    setCustomers(c.data?.customers ?? []);
    const d = await api<{ docs: SalesDoc[]; error?: { message?: string } }>(`/staff/docs`);
    setDocs(d.data?.docs ?? []);
    setDocsError(d.ok ? null : (d.data?.error?.message ?? "Could not load documents — press Refresh to retry"));
    const sl = await api<{ staff: { id: number; name: string; role: string }[] }>(`/staff/staff-list`);
    setStaffList(sl.data?.staff ?? []);
    // v1.4.101: item descriptions suggest from Inventory (manual entry still fine).
    const inv = await api<{ items?: { name: string; sku: string; unit_price_cents?: number }[] }>(`/staff/inventory`);
    setInvItems(inv.data?.items ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const addCustomer = async () => {
    if (!cust.company) return;
    /* v1.4.235 (CEO: "existing data I can edit and update or delete"):
       the same form saves a new customer OR updates the one being edited
       (PUT sends every field; empty boxes clear the stored value). */
    if (editingCust) {
      const res = await api<{ error?: { message?: string } }>(`/staff/customers/${editingCust.id}`, { method: "PUT", body: JSON.stringify(cust) });
      if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Update failed", "notice"); return; }
      showToast("Saved", `${cust.company} updated`);
    } else {
      await api(`/staff/customers`, { method: "POST", body: JSON.stringify(cust) });
      showToast("Saved", `${cust.company} added`);
    }
    setCust({ company: "", contact_person: "", phone: "", email: "", address: "" });
    setEditingCust(null);
    void load();
  };
  const resetDocForm = () => {
    setDoc({ doc_type: "QT", customer_id: -1, salesperson_id: 0, kind: "product", items: [{ name: "", qty: 1, unit_price_cents: 0 }],
      discount_cents: 0, tax_percent: 0, delivery_cents: 0, paid_received: false, reference: "", delivery_address: "" });
    setDocDate(""); setPaidDate(""); setEditingDoc(null);
  };

  const createDoc = async () => {
    // v1.4.94: silent returns were why "nothing saved" — every stop now says why.
    if (doc.customer_id === -1) { showToast("No changes", "Choose a customer first (Walk-in counts)", "notice"); return; }
    if (doc.items.some((i) => !i.name.trim())) { showToast("No changes", "Every line needs an item description", "notice"); return; }
    if (doc.items.every((i) => !i.unit_price_cents)) { showToast("No changes", "Enter a unit price (RM)", "notice"); return; }
    const payload = {
      ...doc,
      salesperson_id: doc.salesperson_id || undefined,
      doc_date: docDate || undefined,
      paid_date: doc.paid_received ? (paidDate || docDate || undefined) : undefined,
    };
    if (editingDoc) {
      const res = await api<{ stock?: Parameters<typeof stockToastLine>[0]; error?: { message?: string } }>(`/staff/docs/${editingDoc.id}/edit`, { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Update failed — check access", "notice"); return; }
      // v1.4.265: an edited product invoice re-balances stock — say what moved.
      showToast("Saved", `${editingDoc.doc_number} updated${stockToastLine(res.data?.stock)}`);
      const idP = editingDoc.id;
      resetDocForm(); void load();
      void printDoc(idP); // fresh PDF straight after the fix
      return;
    }
    type StockMove = { deducted: { sku: string; qty: number; stock: number }[]; unmatched: string[]; short: string[] } | null;
    const res = await api<{ id?: number; doc_number?: string; stock?: StockMove; error?: { message?: string } }>(`/staff/docs`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok || !res.data?.id) { showToast("No changes", res.data?.error?.message ?? "Create failed — check access", "notice"); return; }
    showToast("Saved", `${res.data.doc_number ?? "Document"} created${doc.paid_received ? " — PAID" : ""}${stockToastLine(res.data.stock)}`);
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
    const kind = { QT: "Quotation", INV: "Invoice", DO: "Delivery Order" }[d.doc_type] ?? "Document";
    const filename = `${d.doc_number}.pdf`;
    let blob: Blob | null = null;
    try {
      const r = await fetch(`/api/v1/staff/docs/${d.id}`, { credentials: "include" });
      if (r.ok) {
        const { doc: full } = (await r.json()) as { doc: DocFull };
        blob = await buildDocPdf(full);
      }
    } catch { blob = null; }

    if (blob && typeof navigator.canShare === "function") {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${kind} ${d.doc_number}` });
          return;
        } catch { /* the sheet was dismissed — don't fall through to a download */ 
          return;
        }
      }
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast("PDF ready", `${filename} saved — attach it from your files`);
      return;
    }

    const res = await api<{ url?: string; error?: { message?: string } }>(`/staff/docs/${d.id}/share`, { method: "POST", body: JSON.stringify({}) });
    if (!res.ok || !res.data?.url) {
      showToast("No changes", res.data?.error?.message ?? "Could not prepare the document", "notice");
      return;
    }
    const url = res.data.url;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: `${kind} ${d.doc_number}`, url }); return; } catch { /* dismissed */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link ready", `${d.doc_number} — link copied, paste it to your customer`);
    } catch { showToast("Link ready", url); }
  };
  const setStatus = async (d: SalesDoc, value: string, paymentRef?: string, paidOn?: string) => {
    const body = d.doc_type === "INV"
      ? value === "paid"
        ? { payment_status: "paid", payment_method: "bank_transfer", payment_ref: paymentRef || undefined, paid_on: paidOn || undefined }
        : { payment_status: value }
      : { delivery_status: value };
    await api(`/staff/docs/${d.id}`, { method: "PATCH", body: JSON.stringify(body) });
    void load();
  };

  const subtotal = doc.items.reduce((s, i) => s + i.qty * i.unit_price_cents, 0);
  // v1.4.160: delivery / postage fee — added after discount + tax (pass-through
  // charge, not taxable goods value); never applies to a Delivery Order.
  const total = Math.max(0, Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100)))
    + (doc.doc_type === "DO" ? 0 : doc.delivery_cents);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">
            {editingCust ? <>Editing {editingCust.company} <button type="button" className="ml-1 text-xs font-normal underline" onClick={() => { setEditingCust(null); setCust({ company: "", contact_person: "", phone: "", email: "", address: "" }); }}>cancel</button></> : "Add customer"}
          </p>
          <div className="mt-3 space-y-3">
            <Sub t="Company *">
              <input className={inputClass} placeholder="e.g. ELFIA Official Store" value={cust.company} onChange={(e) => setCust((c) => ({ ...c, company: e.target.value }))} />
            </Sub>
            <div className="grid grid-cols-2 gap-3">
              <Sub t="Contact person">
                <input className={inputClass} placeholder="Full name" value={cust.contact_person} onChange={(e) => setCust((c) => ({ ...c, contact_person: e.target.value }))} />
              </Sub>
              <Sub t="Phone">
                <input className={inputClass} placeholder="+60 12-345 6789" value={cust.phone} onChange={(e) => setCust((c) => ({ ...c, phone: e.target.value }))} />
              </Sub>
            </div>
            <Sub t="Email">
              <input className={inputClass} placeholder="name@company.com" value={cust.email} onChange={(e) => setCust((c) => ({ ...c, email: e.target.value }))} />
            </Sub>
            <Sub t="Address">
              {/* v1.4.235: prints on the customer's documents. */}
              <textarea className={`${inputClass} min-h-16`} placeholder={"No. 12, Jalan Contoh 3/4,\nTaman Contoh, 81200 Johor Bahru, Johor"} value={cust.address} onChange={(e) => setCust((c) => ({ ...c, address: e.target.value }))} />
            </Sub>
            <button type="button" className={btnClass} onClick={() => void addCustomer()}>{editingCust ? "Update customer" : "Save customer"}</button>
          </div>
          <div className="mt-3 max-h-56 overflow-y-auto">
            {customers.length === 0 && (
              <p className="text-muted-foreground text-sm">No customers yet.</p>
            )}
            {customers.map((c) => (
              <div key={c.id} className="border-border border-b py-1.5 text-sm last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  {/* v1.4.249: the company name opens the record — contact
                      details and both addresses were invisible in this list. */}
                  <RecordToggle open={openCust === c.id} title="Contact and addresses"
                    onToggle={() => setOpenCust(openCust === c.id ? null : c.id)}>{c.company}</RecordToggle>
                  {c.contact_person && (
                    <span className="text-muted-foreground"> · {c.contact_person}</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {docs.some((d) => d.doc_type === "INV" && d.company === c.company) && (
                    <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs hover:bg-secondary"
                      title="Statement of Account — all invoices, paid + outstanding, printable"
                      onClick={() => printSOA(c.company, docs)}>SOA</button>
                  )}
                  {/* v1.4.235: edit loads the record into the form above;
                      delete is refused by the server while documents exist. */}
                  <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs hover:bg-secondary"
                    onClick={() => {
                      setEditingCust({ id: c.id, company: c.company });
                      setCust({ company: c.company, contact_person: c.contact_person ?? "", phone: c.phone ?? "", email: c.email ?? "", address: (c as { address?: string | null }).address ?? "" });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}>✎ Edit</button>
                  <button type="button" className="inline-flex h-7 items-center rounded-lg border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50"
                    onClick={async () => {
                      if (!(await askConfirm({
                        title: `Delete ${c.company}?`,
                        message: "Only possible when they have no documents — quotations and invoices must keep their customer for records.",
                        confirmLabel: "Delete customer",
                        variant: "danger",
                      }))) return;
                      const res = await api<{ error?: { message?: string } }>(`/staff/customers/${c.id}`, { method: "DELETE" });
                      if (res.ok) { showToast("Deleted", `${c.company} removed`); if (editingCust?.id === c.id) { setEditingCust(null); setCust({ company: "", contact_person: "", phone: "", email: "", address: "" }); } void load(); }
                      else showToast("No changes", res.data?.error?.message ?? "Delete refused", "notice");
                    }}>Delete</button>
                </span>
              </div>
              {openCust === c.id && (
                <DetailGrid items={[
                  { label: "Contact", value: c.contact_person ?? "" },
                  { label: "Phone", value: c.phone ?? "" },
                  { label: "Email", value: c.email ?? "" },
                  { label: "Billing address", wide: true, value: (c as { address?: string | null }).address ?? "" },
                  { label: "Delivery address", wide: true, value: (c as { delivery_address?: string | null }).delivery_address ?? "" },
                ]} />
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
            {editingDoc ? <>Editing {editingDoc.doc_number} <button type="button" className="ml-1 text-xs font-normal underline" onClick={resetDocForm}>cancel</button></> : "Create document"}
          </p>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Document type</span>
                <select className={inputClass} value={doc.doc_type} onChange={(e) => setDoc((d) => ({ ...d, doc_type: e.target.value }))}>
                  <option value="QT">Quotation</option>
                  {/* v1.4.234: a Delivery Order is product-only — nothing
                      physical ships for a service, so the option hides. */}
                  {doc.kind !== "service" && <option value="DO">Delivery Order</option>}
                  {canInvoice && <option value="INV">Invoice</option>}
                </select>
              </label>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Customer</span>
                <select className={inputClass} value={doc.customer_id} onChange={(e) => setDoc((d) => ({ ...d, customer_id: Number(e.target.value) }))}>
                  <option value={-1}>Choose customer…</option>
                  <option value={0}>🚶 Walk-in / general buyer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs">This document is for</span>
              {/* v1.4.234 (CEO: 2 business lines — product vs service; "details
                  just filled by one details"): ONE line per document. The
                  choice tags the document, steers the item placeholder, and
                  removes Delivery Order for services. */}
              <div className="flex gap-2">
                {([["product", "📦 Product — ELFIA goods"], ["service", "🛠 Service — agency work"]] as const).map(([k, label]) => (
                  <button key={k} type="button"
                    className={
                      "h-9 flex-1 rounded-lg border px-3 text-xs font-medium " +
                      (doc.kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary")
                    }
                    onClick={() => setDoc((d) => ({ ...d, kind: k, doc_type: k === "service" && d.doc_type === "DO" ? "QT" : d.doc_type, delivery_cents: k === "service" ? 0 : d.delivery_cents }))}>
                    {label}
                  </button>
                ))}
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Document date (backdate allowed)</span>
                <input type="date" className={inputClass} value={docDate}
                  max={new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)}
                  onChange={(e) => setDocDate(e.target.value)} />
              </label>
              {doc.doc_type === "INV" && doc.paid_received ? (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">Payment received date</span>
                  <input type="date" className={inputClass} value={paidDate}
                    max={new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)}
                    onChange={(e) => setPaidDate(e.target.value)} />
                </label>
              ) : <span />}
            </div>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs">Sales person (who made this sale)</span>
              <select className={inputClass} value={doc.salesperson_id} onChange={(e) => setDoc((d) => ({ ...d, salesperson_id: Number(e.target.value) }))}
                title="Captured from your login automatically — change it only when creating on someone else's behalf">
                <option value={0}>{firstName(user.name)} — me (auto from login)</option>
                {staffList.filter((u) => u.name !== user.name).map((u) => <option key={u.id} value={u.id}>{firstName(u.name)} — {u.role.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            {/* v1.4.243 (CEO's Malaysian-standard document): the buyer's own
                reference prints in the meta strip — "N/A" when blank — and a
                ship-to address prints beside the billing block. A service
                delivers nothing physical, so the address box is product-only
                (same rule as Delivery / postage since v1.4.238). */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Their reference / PO no. (optional)</span>
                <input className={inputClass} placeholder="e.g. PO-2608" maxLength={60} value={doc.reference}
                  onChange={(e) => setDoc((d) => ({ ...d, reference: e.target.value }))} />
              </label>
              {doc.kind === "product" ? (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">Delivery address (only if different)</span>
                  <input className={inputClass} placeholder="Leave blank — same as billing" maxLength={300} value={doc.delivery_address}
                    onChange={(e) => setDoc((d) => ({ ...d, delivery_address: e.target.value }))} />
                </label>
              ) : <span />}
            </div>
            <div className="text-muted-foreground hidden gap-2 text-xs sm:grid sm:grid-cols-[1fr_66px_66px_100px_100px_auto]">
              <span>Item / service description</span><span>UOM</span><span>Qty</span><span>Unit price (RM)</span><span>Discount (RM)</span><span />
            </div>
            {doc.items.map((item, i) => {
              // one helper so every field on the line edits the same way
              const patch = (p: Partial<DocItem>) =>
                setDoc((d) => ({ ...d, items: d.items.map((x, xi) => (xi === i ? { ...x, ...p } : x)) }));
              return (
              <div key={i} className="border-border grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_66px_66px_100px_100px_auto] sm:border-0 sm:p-0">
                <input className={`${inputClass} col-span-2 sm:col-span-1`} placeholder={doc.kind === "service" ? "e.g. TikTok LIVE hosting — 8 sessions" : "e.g. Tudung Bawal Premium"} value={item.name} list={doc.kind === "service" ? undefined : "inv-item-suggestions"}
                  onChange={(e) => {
                    const v = e.target.value;
                    const hit = invItems.find((it) => it.name === v);
                    patch({ name: v, sku: hit?.sku ?? item.sku,
                      unit_price_cents: hit?.unit_price_cents && !item.unit_price_cents ? hit.unit_price_cents : item.unit_price_cents });
                  }} />
                <input className={inputClass} placeholder="UOM" maxLength={12} value={item.uom ?? ""}
                  title="Unit of measure — PCS, UNIT, SET, VIDEO, SESSION…"
                  onChange={(e) => patch({ uom: e.target.value.toUpperCase() })} />
                <input type="number" min={1} className={inputClass} value={item.qty}
                  onChange={(e) => patch({ qty: Number(e.target.value) })} />
                <input type="number" min={0} step="0.01" className={inputClass} placeholder="0.00"
                  value={item.unit_price_cents ? (item.unit_price_cents / 100).toString() : ""}
                  onChange={(e) => patch({ unit_price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} />
                <input type="number" min={0} step="0.01" className={inputClass} placeholder="0.00"
                  title="Discount on THIS line — the document-level discount stays separate"
                  value={item.disc_cents ? (item.disc_cents / 100).toString() : ""}
                  onChange={(e) => patch({ disc_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} />
                {doc.items.length > 1
                  ? <button type="button" className="text-destructive text-xs underline" title="Remove this line"
                      onClick={() => setDoc((d) => ({ ...d, items: d.items.filter((_, xi) => xi !== i) }))}>✕</button>
                  : <span className="w-4" />}
                {/* v1.4.243: inclusions belong UNDER their line, not as extra
                    RM 0.00 rows — they print as bullets beneath the item. */}
                <textarea className={`${inputClass} col-span-2 min-h-[4rem] sm:col-span-6`}
                  placeholder="Detail lines — one inclusion per line (optional). e.g. Storyboard"
                  value={(item.sub ?? []).join("\n")}
                  onChange={(e) => patch({ sub: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10) })} />
              </div>
              );
            })}
            <datalist id="inv-item-suggestions">
              {invItems.map((it) => <option key={it.sku} value={it.name}>{`SKU ${it.sku}${it.unit_price_cents ? ` · ${fmtRM(it.unit_price_cents)}` : ""}`}</option>)}
            </datalist>
            <button type="button" className="text-xs underline" onClick={() => setDoc((d) => ({ ...d, items: [...d.items, { name: "", qty: 1, unit_price_cents: 0 }] }))}>
              + Add line
            </button>
            <div className={`grid grid-cols-2 gap-3 ${doc.doc_type !== "DO" ? "sm:grid-cols-3" : ""}`}>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Discount (RM, optional)</span>
                <input type="number" min={0} step="0.01" className={inputClass} placeholder="0.00"
                  value={doc.discount_cents ? (doc.discount_cents / 100).toString() : ""}
                  onChange={(e) => setDoc((d) => ({ ...d, discount_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) }))} />
              </label>
              {/* v1.4.160: delivery / postage fee — quoted on the QT, billed on
                  the INV; a Delivery Order carries goods only (Malaysian
                  standard), so the field hides for DO. */}
              {/* v1.4.238: no Delivery / postage on a service document —
                  the box hides and the value zeroes when Service is picked;
                  the server forces 0 regardless. */}
              {doc.doc_type !== "DO" && doc.kind !== "service" && (
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">Delivery / postage (RM, optional)</span>
                  <input type="number" min={0} step="0.01" className={inputClass} placeholder="0.00"
                    value={doc.delivery_cents ? (doc.delivery_cents / 100).toString() : ""}
                    onChange={(e) => setDoc((d) => ({ ...d, delivery_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) }))} />
                </label>
              )}
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Tax % (optional)</span>
                <input type="number" min={0} step={0.5} className={inputClass} placeholder="0"
                  value={doc.tax_percent || ""}
                  onChange={(e) => setDoc((d) => ({ ...d, tax_percent: Number(e.target.value || 0) }))} />
              </label>
            </div>
            {doc.doc_type === "INV" && (
              <label className="flex items-center gap-1.5 text-sm" title="Payment already in hand (e.g. bank transfer received) — the invoice is created as PAID and counts in revenue immediately">
                <input type="checkbox" checked={doc.paid_received} onChange={(e) => setDoc((d) => ({ ...d, paid_received: e.target.checked }))} />
                Payment already received (bank transfer)
              </label>
            )}
            <p className="text-sm font-medium">Total: {fmtRM(total)}</p>
            <button type="button" className={btnClass} onClick={() => void createDoc()}>{editingDoc ? `Update ${editingDoc.doc_number}` : "Create with auto number"}</button>
          </div>
        </div>
      </div>

      {(() => {
        // v1.4.101: overdue invoice aging 30/60/90 + WhatsApp reminder link.
        const todayMs = Date.now() + 8 * 3600 * 1000;
        const unpaid = docs.filter((d) => d.doc_type === "INV" && d.payment_status !== "paid");
        if (unpaid.length === 0) return null;
        const age = (d: SalesDoc) => Math.floor((todayMs - new Date(d.created_at.slice(0, 10) + "T00:00:00Z").getTime()) / 86400000);
        const bucket = (n: number) => n <= 30 ? ["1–30 days", "bg-amber-100 text-amber-800"] : n <= 60 ? ["31–60 days", "bg-orange-100 text-orange-800"] : n <= 90 ? ["61–90 days", "bg-red-100 text-red-700"] : ["90+ days", "bg-red-200 text-red-800"];
        return (
          <div className={card}>
            <p className="text-sm font-semibold">⏳ Outstanding invoices — aging</p>
            <p className="text-muted-foreground mt-0.5 text-xs">Unpaid invoices by age. WhatsApp opens a pre-written reminder with the invoice number, amount and bank details.</p>
            <div className="mt-2 space-y-1.5">
              {unpaid.sort((a, b) => age(b) - age(a)).map((d) => {
                const n = age(d);
                const [label, cls] = bucket(n);
                const phone = (d.customer_phone ?? "").replace(/[^0-9]/g, "");
                const msg = encodeURIComponent(`Hi! Gentle reminder from AZ ONE OFFICIAL — invoice ${d.doc_number} (${fmtRM(d.total_cents)}) is still outstanding. Kindly settle by bank transfer to MAYBANK · AZ ONE OFFICIAL · A/C 5516 2328 7032, quoting the invoice number. Thank you!`);
                return (
                  <div key={d.id} className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-1.5 text-sm last:border-0">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="font-medium">{d.doc_number}</span>{d.kind && <span title={d.kind === "service" ? "Service document" : "Product document"}> {d.kind === "service" ? "🛠" : "📦"}</span>} · {d.company} · {fmtRM(d.total_cents)}
                      <span className="text-muted-foreground"> · {n} days</span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                      <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ${cls}`}>{label}</span>
                      {phone
                        ? <a className="inline-flex h-7 items-center rounded-lg bg-green-600 px-2.5 text-xs font-medium text-white" target="_blank" rel="noreferrer"
                            href={`https://wa.me/${phone.startsWith("60") ? phone : "6" + phone}?text=${msg}`}>WhatsApp reminder</a>
                        : <span className="text-muted-foreground inline-flex h-7 items-center text-xs" title="Add a phone number on the customer record to enable one-tap reminders">no phone</span>}
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
          <p className="text-sm font-semibold">Documents</p>
          <button type="button" className="text-xs underline" onClick={() => void load()}>Refresh</button>
        </div>
        {docsError && <p className="mt-2 text-sm font-medium text-amber-700">{docsError}</p>}
        {!docsError && docs.length === 0 && <p className="text-muted-foreground mt-2 text-sm">No documents yet.</p>}
        <div className="max-h-96 overflow-y-auto">
        {docs.map((d) => (
          <div key={d.id} className="border-border border-b py-2 text-sm last:border-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* v1.4.248 (CEO: "a minimalist version … click at the document
                number can appear the details. the button remain at outside"):
                the row carries only what identifies the document. Status
                chips, the payment/delivery pickers and the dates live in the
                panel below, opened by clicking the number. Actions stay on
                the row so nothing needs opening to be done. */}
            <span className="min-w-0 flex-1 basis-64">
              <RecordToggle open={openDoc === d.id} title="Payment, dates and reference"
                onToggle={() => setOpenDoc(openDoc === d.id ? null : d.id)}>{d.doc_number}</RecordToggle>
              {d.kind && <span title={d.kind === "service" ? "Service document" : "Product document"}> {d.kind === "service" ? "🛠" : "📦"}</span>} · {d.company} · {fmtRM(d.total_cents)}
            </span>
            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {d.doc_type === "INV" && canInvoice && (
              <select className="border-input bg-background h-7 rounded-lg border px-2 text-xs" value={d.payment_status ?? "unpaid"}
                title="Mark paid when the bank transfer lands — revenue counts payments received"
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
                        title: "Payment received",
                        message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                        label: "Bank transfer reference (optional)",
                        placeholder: "e.g. MBB240726-8891",
                        confirmLabel: "Mark paid",
                        date: { label: "Date the payment was received", initial: today, max: today },
                      });
                      if (got === null) return;          // cancelled — status unchanged
                      await setStatus(d, "paid", got.value || undefined, got.date || undefined);
                    })();
                  } else {
                    void setStatus(d, v);
                  }
                }}>
                {["unpaid", "paid", "overdue"].map((sx) => <option key={sx} value={sx}>{sx}</option>)}
              </select>
            )}
            {d.doc_type === "DO" && (
              <select className="border-input bg-background h-7 rounded-lg border px-2 text-xs" value={d.delivery_status ?? "pending"} onChange={(e) => void setStatus(d, e.target.value)}>
                {["pending", "delivered"].map((sx) => <option key={sx} value={sx}>{sx}</option>)}
              </select>
            )}
            {/* v1.4.233 (CEO: "reversal button … if accidentally click
                invoice"): only on an INV that came from a QT and is still
                unpaid — a paid invoice can never be reversed. Deletes the
                accidental invoice; the quotation stands untouched. */}
            {d.doc_type === "INV" && d.converted_from != null && d.payment_status !== "paid" && canInvoice && (
              <button type="button" className="inline-flex h-7 items-center rounded-lg border border-amber-700 px-2.5 text-xs font-medium text-amber-800"
                title="Undo the Quotation → Invoice click: deletes this unpaid invoice; the quotation is untouched"
                onClick={async () => {
                  if (!(await askConfirm({
                    title: `Reverse ${d.doc_number}?`,
                    message: "This deletes the invoice (it was created from a quotation and is still unpaid).\nThe quotation itself is not touched.",
                    confirmLabel: "Reverse invoice",
                    variant: "danger",
                  }))) return;
                  const res = await api<{ error?: { message?: string } }>(`/staff/docs/${d.id}/unconvert`, { method: "POST", body: JSON.stringify({}) });
                  if (res.ok) { showToast("Reversed", `${d.doc_number} deleted — the quotation stands`); await load(); }
                  else showToast("No changes", res.data?.error?.message ?? "Reversal failed", "notice");
                }}>↩ Undo</button>
            )}
            {d.doc_type === "QT" && canInvoice && (
              <button type="button" className="inline-flex h-7 items-center rounded-lg bg-[#1A2946] px-2.5 text-xs font-medium text-white"
                title="One click Quotation → Invoice: same items, customer and sales person, fresh INV number"
                onClick={async () => {
                  const res = await api<{ id?: number; doc_number?: string; stock?: Parameters<typeof stockToastLine>[0]; error?: { message?: string } }>(`/staff/docs/${d.id}/convert`, { method: "POST", body: JSON.stringify({}) });
                  if (!res.ok || !res.data?.id) { showToast("No changes", res.data?.error?.message ?? "Conversion failed — check access", "notice"); return; }
                  showToast("Saved", `${d.doc_number} → ${res.data.doc_number}${stockToastLine(res.data.stock)}`);
                  await load();
                  void printDoc(res.data.id);
                }}>→ Invoice</button>
            )}
            {d.doc_type === "QT" && !canInvoice && <span className="text-muted-foreground inline-flex h-7 items-center text-xs">Quotation</span>}
            <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs hover:bg-secondary"
              title="Fix a typo — loads the document into the form; the number never changes"
              onClick={async () => {
                const r = await fetch(`/api/v1/staff/docs/${d.id}`, { credentials: "include" });
                if (!r.ok) return;
                const { doc: full } = (await r.json()) as { doc: DocFull & { customer_id?: number; salesperson_id?: number | null } };
                let its: DocItem[] = [];
                try { its = JSON.parse(full.items); } catch { its = []; }
                setDoc({
                  doc_type: full.doc_type, customer_id: (full as { customer_id?: number }).customer_id ?? -1,
                  salesperson_id: (full as { salesperson_id?: number | null }).salesperson_id ?? 0,
                  items: its.length ? its : [{ name: "", qty: 1, unit_price_cents: 0 }],
                  discount_cents: full.discount_cents ?? 0, tax_percent: full.tax_percent ?? 0,
                  delivery_cents: (full as { delivery_cents?: number }).delivery_cents ?? 0, paid_received: false,
                  kind: (full as { kind?: string | null }).kind ?? "product",
                  reference: (full as { reference?: string | null }).reference ?? "",
                  delivery_address: (full as { delivery_address?: string | null }).delivery_address ?? "",
                });
                setDocDate(full.created_at.slice(0, 10));
                setEditingDoc({ id: d.id, doc_number: d.doc_number });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>Edit</button>
            <button type="button" className={rowBtn}
              onClick={() => void printDoc(d.id)}>PDF</button>
            {/* v1.4.258: NOT primary. A quotation row already has → Invoice
                filled, and v1.4.253's own rule is at most ONE fill per row —
                two dark blocks and neither reads as the main action. */}
            <button type="button" className={rowBtn}
              title="Send the PDF to the customer — opens your phone's share sheet with the file attached"
              onClick={() => void shareDoc(d)}>Send PDF</button>
            {/* v1.4.237 (CEO): delete with confirm; a PAID invoice is
                refused by the server. Aging recomputes from this list, so
                a deleted unpaid invoice drops out of it immediately. */}
            {canInvoice && (
              <button type="button" className="inline-flex h-7 items-center rounded-lg border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50"
                onClick={async () => {
                  if (!(await askConfirm({
                    title: `Delete ${d.doc_number}?`,
                    message: `${d.doc_type === "INV" ? "It will disappear from Documents and from Outstanding invoices — aging." : "It will disappear from Documents."}\nThis cannot be undone.`,
                    confirmLabel: "Delete document",
                    variant: "danger",
                  }))) return;
                  const res = await api<{ error?: { message?: string } }>(`/staff/docs/${d.id}`, { method: "DELETE" });
                  if (res.ok) { showToast("Deleted", `${d.doc_number} removed`); await load(); }
                  else showToast("No changes", res.data?.error?.message ?? "Delete refused", "notice");
                }}>Delete</button>
            )}
            </span>
          </div>
          {openDoc === d.id && (
            <DetailGrid items={[
              { label: "Type", value: `${{ QT: "Quotation", INV: "Invoice", DO: "Delivery Order" }[d.doc_type] ?? d.doc_type}${d.kind ? ` · ${d.kind === "service" ? "Service" : "Product"}` : ""}` },
              { label: "Date", value: dmy(d.created_at.slice(0, 10)) },
              { label: "Sales person", value: d.salesperson_name ? firstName(d.salesperson_name) : "" },
              { label: "Customer phone", value: d.customer_phone ?? "" },
              { label: "Payment", wide: true, value: d.doc_type !== "INV" ? "" : d.payment_status === "paid" ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-green-700">PAID · bank transfer</span>
                  {d.paid_at && <span className="text-muted-foreground">{dmy(d.paid_at.slice(0, 10))}</span>}
                  {d.payment_ref && <span className="text-muted-foreground">Ref {d.payment_ref}</span>}
                  {/* v1.4.250: the date is correctable without unmarking the
                      invoice — unmarking would clear the reference too. */}
                  {canInvoice && (
                    <button type="button" className="underline" title="Correct the date the payment was received"
                      onClick={async () => {
                        const today = mytToday();
                        const got = await askText({
                          title: "Correct the payment date",
                          message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                          label: "Bank transfer reference (optional)",
                          initial: d.payment_ref ?? "",
                          confirmLabel: "Save",
                          date: { label: "Date the payment was received", initial: d.paid_at ? d.paid_at.slice(0, 10) : today, max: today },
                        });
                        if (got === null) return;
                        await setStatus(d, "paid", got.value || undefined, got.date || undefined);
                      }}>✎ change date</button>
                  )}
                </span>
              ) : <span className="text-amber-700">{d.payment_status ?? "unpaid"}</span> },
              { label: "Origin", wide: true, value: d.converted_from != null ? "Converted from a quotation" : "" },
            ]} />
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
    void api<{ profile: Record<string, string | null> }>(`/staff/profile`).then((r) => {
      if (r.data?.profile) {
        setProfile(r.data.profile);
        setPhone(r.data.profile.phone ?? "");
      }
    });
  }, []);
  const save = async () => {
    if (phone === (profile.phone ?? "")) {
      showToast("No changes", "Phone number unchanged", "notice");
      return;
    }
    setSaving(true);
    const res = await api(`/staff/profile`, { method: "PATCH", body: JSON.stringify({ phone }) });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setProfile((pr) => ({ ...pr, phone }));
      setTimeout(() => setSaved(false), 2000);
      showToast("Saved", "Phone number updated");
    } else {
      alert("Failed to save phone number");
    }
  };
  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
      <div className={card}>
        <p className="text-sm font-semibold">My profile</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {["name", "email", "role", "employee_id", "position", "department", "employment_status"].map((k) => (
            <div key={k}>
              <dt className="text-muted-foreground text-[11px] capitalize">{k.replace("_", " ")}</dt>
              <dd className="font-medium break-words">{profile[k] ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {toastNode}
        <label className="mt-4 block">
          <span className="text-muted-foreground mb-1 block text-xs">Phone (you can update this)</span>
          <input className={inputClass} placeholder="+60 12-345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button type="button" disabled={saving} className={`${btnClass} mt-3`} onClick={() => void save()}>
        {saving ? "Saving..." : saved ? "Saved!" : "Save"}
      </button>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Change password</p>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">
          Changing your password signs you out on every other device
          immediately. Google sign-in accounts manage their password with
          Google instead.
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
  const [rows, setRows] = useState<{ id: number; name: string; full_name?: string | null; email: string; role: string; employment_status?: string | null; is_active: number; left_on?: string | null; rejoined_on?: string | null; totp_enabled?: number }[]>([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<{ action: string; created_at: string; name?: string | null; email?: string | null }[]>([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY — Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  const canEdit = role === "super_admin";
  const ROLE_OPTIONS = ["customer", "live_host", "editor", "marketing", "sales_marketing", "hr_admin", "cco", "coo", "ceo"];
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ role: string; employment_status: string }>({ role: "live_host", employment_status: "part_time" });
  const { show: showToast, node: toastNode } = useSaveToast();
  const load = useCallback(() => {
    void api<{ users?: typeof rows; staff?: typeof rows }>(`/staff/users`).then((r) => {
      if (r.ok && r.data) setRows((r.data.users ?? r.data.staff ?? []).filter((u) => !["super_admin", "admin"].includes(u.role)));
      else setMsg("Could not load user accounts — check access.");
    });
    void api<{ events: typeof events }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  const saveRole = async (u: { id: number; name: string; email: string }) => {
    const res = await api<{ role?: string; employment_status?: string; error?: { message?: string } }>(`/staff/users/${u.id}/role`, {
      method: "POST",
      body: JSON.stringify({ role: draft.role, employment_status: draft.employment_status }),
    });
    if (res.ok) {
      showToast("Saved", `${firstName(u.name)} → ${draft.role.replace(/_/g, " ")} (${(res.data?.employment_status ?? draft.employment_status).replace(/_/g, " ")})`);
      setEditId(null);
      load();
    } else {
      showToast("Not saved", res.data?.error?.message ?? "Role change failed", "notice");
    }
  };
  const roleEditor = (u: { id: number; name: string; email: string; role: string; employment_status?: string | null }) => (
    <div className="mt-2 grid w-full grid-cols-2 items-end gap-2 rounded-lg bg-secondary/40 p-2 sm:flex sm:flex-wrap">
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Role</span>
        <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Employment status</span>
        <select className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.employment_status} onChange={(e) => setDraft((d) => ({ ...d, employment_status: e.target.value }))}>
          {EMP_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <button type="button" className="bg-primary text-primary-foreground col-span-1 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium"
        onClick={() => void saveRole(u)}>Save</button>
      <button type="button" className="text-xs underline" onClick={() => setEditId(null)}>Cancel</button>
      {!u.email.toLowerCase().endsWith("@azoneofficial.com") && draft.role !== "customer" && (
        <p className="text-muted-foreground col-span-2 w-full text-[11px]">
          Personal-email (Google) account — staff roles are saved as <span className="font-medium">part time</span>; permanent staff need an @azoneofficial.com account.
        </p>
      )}
    </div>
  );
  const staffRows = rows.filter((u) => u.role !== "customer");
  const customerRows = rows.filter((u) => u.role === "customer");
  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">User accounts</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {canEdit
          ? "Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin."
          : "Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role."}
      </p>
      {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      {/* v1.4.161: staff + customer lists sit side-by-side on desktop to cut
          the scroll in half; they stack normally on phones. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
      <div>
      {/* v1.4.167: both columns carry the same heading + one-line description
          structure so the two list boxes top-align (the CEO's screenshot
          showed the customer box starting lower). */}
      <p className="mt-4 text-sm font-semibold lg:mt-0">Staff accounts</p>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">
        Role always shows — chips flag exceptions only (part-time, disabled, missing 2FA).
      </p>
      {/* v1.4.161 (CEO: "minimalist the card box — too long to scroll"):
          one bordered box with hairline-divided single-line rows instead of
          stacked card boxes; chips show EXCEPTIONS only (non-permanent
          status, disabled, 2FA missing) — role always shows. Everything
          truncates so a phone row stays one line. */}
      <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
        {staffRows.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{properName(u.full_name || u.name)}</span>
              <span className="text-muted-foreground text-xs"> · {u.email}</span>
            </span>
            <span className="flex flex-wrap items-center justify-end gap-1">
              <span className="bg-secondary rounded-full px-1.5 py-px text-[10px] capitalize">{u.role.replace(/_/g, " ")}</span>
              {(u.employment_status ?? "permanent") !== "permanent" && (
                <span className={`rounded-full px-1.5 py-px text-[10px] capitalize ${["resigned", "terminated"].includes(u.employment_status ?? "") ? "bg-red-100 text-red-700" : "bg-secondary"}`}
                  title={`${u.left_on ? `until ${dmy(u.left_on)}` : ""}${u.rejoined_on ? ` · rejoined ${dmy(u.rejoined_on)}` : ""}`}>
                  {(u.employment_status ?? "").replace(/_/g, " ")}
                </span>
              )}
              {!u.is_active && <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">disabled</span>}
              {!u.totp_enabled && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800">2FA ✗</span>}
              {canEdit && editId !== u.id && (
                <button type="button" className="text-[11px] underline"
                  onClick={() => { setEditId(u.id); setDraft({ role: u.role, employment_status: u.employment_status && ["permanent", "contract", "part_time", "probation"].includes(u.employment_status) ? u.employment_status : "permanent" }); }}>
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
          ⚠ {staffRows.filter((u) => !u.totp_enabled && u.is_active).length} active account(s) without 2FA — worth chasing: {staffRows.filter((u) => !u.totp_enabled && u.is_active).map((u) => firstName(u.name)).join(", ")}
        </p>
      )}
      </div>

      {/* v1.4.156: Google sign-ups land here as customers — the CEO promotes
          them into part-time roles (e.g. part-time live host) from this list. */}
      <div className="border-border mt-4 border-t pt-3 lg:mt-0 lg:border-t-0 lg:pt-0">
        <p className="text-sm font-semibold">Customer accounts — Google &amp; self sign-ups</p>
        <p className="text-muted-foreground mt-0.5 truncate text-xs"
          title={canEdit
            ? "Personal emails can hold part-time roles only (e.g. part-time live host); permanent staff need an @azoneofficial.com account."
            : "Google and self sign-ups always land here as customers with zero staff access."}>
          {canEdit
            ? "Promote here when someone joins — personal emails hold part-time roles only."
            : "Sign-ups land here with zero staff access — promotions by the super admin only."}
        </p>
        <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
          {customerRows.length === 0 && <p className="text-muted-foreground px-3 py-2 text-sm">No customer accounts yet.</p>}
          {customerRows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{properName(u.full_name || u.name)}</span>
                <span className="text-muted-foreground text-xs"> · {u.email}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1">
                {!u.is_active && <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">disabled</span>}
                {canEdit && editId !== u.id && (
                  <button type="button" className="text-[11px] underline"
                    onClick={() => { setEditId(u.id); setDraft({ role: "live_host", employment_status: "part_time" }); }}>
                    ✎ Promote
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
        <p className="text-sm font-semibold">User log — recent sign-ins &amp; account events</p>
        <p className="text-muted-foreground mt-0.5 text-xs">Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit lives in /admin.</p>
        <div className="mt-2 max-h-56 space-y-0 overflow-y-auto pr-1">
          {events.length === 0 && <p className="text-muted-foreground text-sm">No events recorded yet.</p>}
          {events.map((e, i) => (
            <div key={i} className="border-border flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b py-1 text-[11px] last:border-0">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{properName(e.name ?? "")}</span>
                <span className="text-muted-foreground"> · {e.email ?? ""}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className={`rounded-full px-1.5 py-px text-[10px] ${e.action.includes("2fa_enabled") ? "bg-green-100 text-green-700" : e.action.includes("2fa") ? "bg-blue-100 text-blue-800" : e.action.includes("password") ? "bg-amber-100 text-amber-800" : "bg-secondary"}`}>
                  {e.action.replace("auth.", "").replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">{mytStamp2(e.created_at)}</span>
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
  user_id: number; name: string; role: string; photo_key: string | null;
  sales_cents: number; target_cents: number | null; pct: number | null;
  commission_cents: number; rank: number;
}

/** The sales leaderboard — attributed sales per person this month, progress to
    target, and the commission the active rules would pay. The motivational
    heart of the sales floor. */
function LeaderboardCard({ user }: { user: User }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [hasRules, setHasRules] = useState(false);
  const canSeeCommission = TARGET_ADMIN_ROLES.includes(user.role);
  useEffect(() => {
    void api<{ rows: LeaderRow[]; has_rules: boolean }>(`/staff/leaderboard`).then((r) => {
      if (r.ok && r.data) { setRows(r.data.rows); setHasRules(r.data.has_rules); }
      else setRows([]);
    });
  }, []);
  if (!rows) return null;
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`);
  const top = rows[0]?.sales_cents ?? 0;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">🏆 Sales leaderboard — this month</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Attributed sales per person: paid invoices they closed + TikTok GMV during their live sessions. The whole floor, ranked.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">No attributed sales yet this month — the board fills as invoices are paid and lives run.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const isMe = r.user_id === user.id;
            return (
              <div key={r.user_id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${isMe ? "bg-gold-soft/50 ring-1 ring-gold" : r.rank <= 3 ? "bg-secondary/60" : ""}`}>
                <span className="w-7 shrink-0 text-center text-base">{medal(r.rank)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.name}</span>
                  {isMe && <span className="text-gold-deep ml-1 text-[11px] font-semibold">you</span>}
                  <span className="text-muted-foreground ml-1.5 text-[11px] capitalize">{r.role.replace(/_/g, " ")}</span>
                </span>
                <span className="hidden w-28 shrink-0 sm:block">
                  <MiniBar pct={top > 0 ? (r.sales_cents / top) * 100 : 0} tone={r.rank === 1 ? "green" : "gold"} />
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums font-semibold">{fmtRM(r.sales_cents)}</span>
                {r.pct !== null && (
                  <span className={`hidden w-12 shrink-0 text-right text-xs tabular-nums sm:block ${r.pct >= 100 ? "text-bull font-semibold" : "text-muted-foreground"}`}>{r.pct}%</span>
                )}
                {canSeeCommission && r.commission_cents > 0 && (
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-gold-deep" title="commission the active rules would pay">+{fmtRM(r.commission_cents)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canSeeCommission && !hasRules && rows.length > 0 && (
        <p className="text-muted-foreground mt-2 text-[11px]">Add a commission rule below to show each person&apos;s payout here.</p>
      )}
    </div>
  );
}

interface CommRule { id: number; name: string; base_pct: number; bonus_pct: number; applies_to: string; active: number }

/** Management: per-person & per-team targets, and commission rules. */
function TargetsCommissionCard() {
  const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const [staff, setStaff] = useState<{ id: number; name: string; role: string }[]>([]);
  const [userTargets, setUserTargets] = useState<Record<number, number>>({});
  const [teamTargets, setTeamTargets] = useState<Record<string, number>>({});
  const [rules, setRules] = useState<CommRule[] | null>(null);
  const [draft, setDraft] = useState({ name: "", base_pct: "", bonus_pct: "", applies_to: "all" });
  const { show: showToast, node: toastNode } = useSaveToast();

  const loadTargets = useCallback(() => {
    void api<{ staff: { id: number; name: string; role: string }[]; user_targets: { user_id: number; target_cents: number }[]; team_targets: { team: string; target_cents: number }[] }>(`/staff/targets?month=${month}`).then((r) => {
      if (r.ok && r.data) {
        setStaff(r.data.staff);
        setUserTargets(Object.fromEntries(r.data.user_targets.map((t) => [t.user_id, t.target_cents])));
        setTeamTargets(Object.fromEntries(r.data.team_targets.map((t) => [t.team, t.target_cents])));
      }
    });
  }, [month]);
  const loadRules = useCallback(() => {
    void api<{ rules: CommRule[] }>(`/staff/commission/rules`).then((r) => { if (r.ok && r.data) setRules(r.data.rules); });
  }, []);
  useEffect(() => { loadTargets(); loadRules(); }, [loadTargets, loadRules]);

  const saveTarget = async (scope: "user" | "team", id: number | string, rm: string) => {
    const cents = Math.round(Number(rm) * 100);
    if (!Number.isFinite(cents) || cents < 0) { showToast("No change", "Enter an amount first", "notice"); return; }
    const res = await api(`/staff/targets`, { method: "POST", body: JSON.stringify({ scope, id, month, target_cents: cents }) });
    if (res.ok) { showToast("Saved", `Target set for ${ym(month)}`); loadTargets(); }
  };

  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">🎯 Targets &amp; commission — {ym(month)}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Set each person&apos;s and each team&apos;s monthly goal, and the commission rules that pay them. Feeds the leaderboard and the dashboard.
      </p>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Per-person targets (RM)</p>
        <div className="mt-1.5 space-y-1">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-muted-foreground text-[11px] capitalize">{s.role.replace(/_/g, " ")}</span></span>
              <input type="number" min={0} step="100" className={`${inputClass} h-8 w-28 text-xs`}
                defaultValue={userTargets[s.id] ? (userTargets[s.id] / 100).toString() : ""}
                placeholder="e.g. 8000"
                onBlur={(e) => { if (e.target.value) void saveTarget("user", s.id, e.target.value); }} />
            </div>
          ))}
          {staff.length === 0 && <p className="text-muted-foreground text-xs">No staff to target yet.</p>}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Team targets (RM)</p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {["sales", "live"].map((team) => (
            <label key={team} className="flex items-center gap-2 text-sm">
              <span className="capitalize">{team}</span>
              <input type="number" min={0} step="100" className={`${inputClass} h-8 w-32 text-xs`}
                defaultValue={teamTargets[team] ? (teamTargets[team] / 100).toString() : ""}
                placeholder="team goal"
                onBlur={(e) => { if (e.target.value) void saveTarget("team", team, e.target.value); }} />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Commission rules</p>
        <div className="mt-1.5 space-y-1">
          {(rules ?? []).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground ml-1.5 text-xs">{r.base_pct}% base{r.bonus_pct ? ` + ${r.bonus_pct}% over target` : ""} · {r.applies_to === "all" ? "everyone" : r.applies_to.replace(/_/g, " ")}</span>
              </span>
              <button type="button" className={btnSm}
                onClick={async () => { await api(`/staff/commission/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ active: r.active ? 0 : 1 }) }); loadRules(); }}>
                {r.active ? "On" : "Off"}
              </button>
              <button type="button" className={`${btnSm} text-destructive`}
                onClick={async () => { await api(`/staff/commission/rules/${r.id}`, { method: "DELETE" }); loadRules(); }}>
                Remove
              </button>
            </div>
          ))}
          {rules && rules.length === 0 && <p className="text-muted-foreground text-xs">No rules yet — add one below (e.g. 1.5% base + 3% over target).</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input className={`${inputClass} h-8 w-40 text-xs`} placeholder="Rule name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className="text-xs">base %<input type="number" min={0} max={100} step="0.1" className={`${inputClass} ml-1 h-8 w-16 text-xs`} value={draft.base_pct} onChange={(e) => setDraft({ ...draft, base_pct: e.target.value })} /></label>
          <label className="text-xs">bonus %<input type="number" min={0} max={100} step="0.1" className={`${inputClass} ml-1 h-8 w-16 text-xs`} value={draft.bonus_pct} onChange={(e) => setDraft({ ...draft, bonus_pct: e.target.value })} /></label>
          <button type="button" className={btnSmPrimary}
            disabled={!draft.name || !draft.base_pct}
            onClick={async () => {
              const res = await api(`/staff/commission/rules`, { method: "POST", body: JSON.stringify({ name: draft.name, base_pct: Number(draft.base_pct), bonus_pct: Number(draft.bonus_pct || 0), applies_to: draft.applies_to }) });
              if (res.ok) { setDraft({ name: "", base_pct: "", bonus_pct: "", applies_to: "all" }); showToast("Saved", "Commission rule added"); loadRules(); }
            }}>
            Add rule
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
const ALL_TABS = ["Dashboard", "Overview", "Announcements", "HR", "Staff Details", "Attendance", "Leave", "Tasks", "Claims", "Payroll", "Expenses", "Sales", "Inventory", "Ecommerce", "Assets", "Birthdays", "Profile", "Users"] as const; // v1.4.213 Assets; v1.4.214 Ecommerce; v1.5.0 Social removed (CEO)
// v1.4.111: one label mapping for EVERY nav renderer (desktop pills leaked
// the raw "Announcements" key — spotted on the CEO's screenshot).
const tabLabel = (t: string) => t === "Announcements" ? "News" : t === "Staff Details" ? "Staff" : t;

/** Which roles see each role-specific tab. The API enforces the same matrix. */
// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];

const TAB_ROLES: Partial<Record<(typeof ALL_TABS)[number], readonly string[]>> = {
  // HR pipeline: docs (QT/DO/INV), leave, attendance + payroll CSV.
  HR: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  Payroll: ["ceo", "coo", "super_admin", "admin"],
  // Expense claims (v1.4.75): CEO/COO/CCO/HR submit; the CEO decides.
  Claims: ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "editor", "marketing", "live_host", "super_admin", "admin"], // v1.4.106: every staff role claims
  // Company expenses (v1.4.87): CEO and COO per spec.
  Expenses: ["ceo", "coo", "super_admin", "admin"],
  // Inventory & tracking: sales_marketing only among staff (editor/marketing
  // and everyone else are excluded).
  Inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  // Read-only company monitor. CEO + COO + CCO + admin tier.
  Overview: ["ceo", "coo", "cco", "super_admin", "admin"],
  // CEO can manage birthdays (their one write exception); HR tier too.
  Birthdays: ["ceo", "hr_admin", "coo", "cco", "super_admin", "admin"],
  // Employee records: IDs, position, department, staff list, birth dates.
  "Staff Details": ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  // v1.4.213: asset register — same tier as Staff Details (HR keeps it).
  Assets: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
  Users: ["super_admin", "ceo", "coo"],
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
  useEffect(() => {
    try {
      const saved = user ? window.localStorage.getItem(`azone-tab:${user.id}`) : null;
      if (saved && (ALL_TABS as readonly string[]).includes(saved)) setTab(saved as TabName);
    } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    try { if (user) window.localStorage.setItem(`azone-tab:${user.id}`, tab); } catch { /* private mode */ }
  }, [tab, user?.id]);
  const [dark, setDark] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  /* v1.4.219: CEO-managed tab access overrides (system_meta). */
  const [tabOverrides, setTabOverrides] = useState<Record<string, string[]>>({});
  useEffect(() => {
    void fetch("/api/v1/staff/tabs/access", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((d) => { if (d && typeof d === "object" && "overrides" in d) setTabOverrides((d as { overrides: Record<string, string[]> }).overrides ?? {}); })
      .catch(() => { /* old worker: defaults apply */ });
  }, []);
  const [showNotifs, setShowNotifs] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // While the More sheet is open, the page behind must not scroll — the
  // sheet then behaves like a native menu instead of a floating layer.
  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [moreOpen]);

  useEffect(() => {
    setDark(localStorage.getItem("azone-theme") === "dark");
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) setUser(r.data.user);
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
  const [pushState, setPushState] = useState<"default" | "granted" | "denied" | "unsupported">("default");
  useEffect(() => {
    setSound(localStorage.getItem("azone-notif-sound") !== "off");
    setPushState(pushPermission());
  }, []);
  const audioRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef<number | null>(null); // null = first load (no chime)
  // v1.6.0: the SSE stream reads the latest list without re-subscribing.
  const notifsRef = useRef<Notification[]>([]);
  useEffect(() => { notifsRef.current = notifs; }, [notifs]);
  useEffect(() => {
    // Unlock on the first gesture so POLL-triggered chimes are allowed later.
    const unlock = () => {
      if (!audioRef.current) {
        try {
          const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AC) audioRef.current = new AC();
        } catch { /* very old browser — chime simply stays off */ }
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
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) { ctx = new AC(); audioRef.current = ctx; }
      } catch { return; }
    }
    if (!ctx) return;
    if (ctx.state !== "running") {
      try { await ctx.resume(); } catch { return; }
    }
    if (ctx.state !== "running") return;
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + at);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.5);
    };
    note(880, 0);      // A5
    note(1174.66, 0.12); // D6 — rising two-tone, short and unobtrusive
  }, []);

  useEffect(() => {
    if (!user) return;
    // v1.6.0: chime + badge logic factored out so both the initial fetch, the
    // safety-net poll, and the live SSE stream feed it.
    const applyList = (list: Notification[]) => {
      const nowUnread = list.filter((n) => !n.is_read).length;
      if (unreadRef.current !== null && nowUnread > unreadRef.current &&
          localStorage.getItem("azone-notif-sound") !== "off") {
        void chime();
      }
      unreadRef.current = nowUnread;
      setNotifs(list);
    };
    const fetchNotifs = () =>
      void api<{ notifications: Notification[] }>("/staff/notifications").then((r) => {
        if (r.data?.notifications) applyList(r.data.notifications);
      });
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
        es = new EventSource(`/api/v1/staff/notifications/stream?since=${sinceId}`, { withCredentials: true });
        es.addEventListener("notifications", (ev) => {
          try {
            const incoming = JSON.parse((ev as MessageEvent).data) as Notification[];
            if (!incoming.length) return;
            const merged = [...incoming.reverse(), ...notifsRef.current]
              .filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i)
              .sort((a, b) => b.id - a.id)
              .slice(0, 50);
            sinceId = Math.max(sinceId, ...incoming.map((n) => n.id));
            applyList(merged);
          } catch { /* ignore malformed frame */ }
        });
        es.onerror = () => { es?.close(); es = null; };
      } catch { /* EventSource unsupported — the poll below carries it */ }
    };
    openStream();
    const reconnect = window.setInterval(() => { if (!es) openStream(); }, 8000);
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
    if (t === "Sales") return SALES_ROLES.includes(user.role) || user.role === "ceo";
    const allowed = TAB_ROLES[t];
    return !allowed || allowed.includes(user.role);
  });
  // v1.4.231 guard: a remembered tab this account can't see → Dashboard.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("Dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join("|"), tab]);

  if (!checked) return null;
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
        <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">Staff Portal</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in required</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          The Staff Portal is for AZ ONE OFFICIAL employees only.
        </p>
        <a href="/login" className={`${btnClass} mt-6`}>Go to login</a>
      </div>
    );
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            Two-Factor Authentication Required
          </h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Your role requires two-factor authentication to be enabled before you can access the staff portal. Please set it up now.
          </p>
          <TwoFactorPanel />
          <div className="mt-8 flex justify-end border-t border-border pt-6">
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button looped users back to
                   the same screen forever. A real server-side logout now. */
                void api("/auth/logout", { method: "POST", body: JSON.stringify({}) })
                  .then(() => { window.location.href = "/login"; });
              }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-3 pb-24 md:px-5 md:py-6 md:pb-6">
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-5 flex items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur md:static md:mx-0 md:gap-3 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          {/* v1.4.141: the badge-card photo as an app-style avatar — circular,
              gold-ringed, next to the welcome on desktop and the screen title
              on mobile. Falls back to the initial when no photo is set. */}
          {user.photo_key ? (
            <img
              src={`/api/v1/media/file/${encodeURIComponent(user.photo_key)}`}
              alt=""
              className="ring-gold h-9 w-9 shrink-0 rounded-full object-cover ring-2 md:h-11 md:w-11"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className="bg-primary text-primary-foreground ring-gold flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 md:h-11 md:w-11">
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">Staff Portal</p>
            <h1 className="hidden truncate text-xl font-semibold tracking-tight md:block">
              Welcome, {user.name.split(" ")[0]}
            </h1>
            {/* On phones the header reads like an app screen title. */}
            <h1 className="truncate text-lg font-semibold tracking-tight md:hidden">{tab}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <button
            type="button"
            className={btnHdr}
            title={sound ? "Notification sound ON — tap to mute" : "Notification sound OFF — tap to unmute"}
            aria-label={sound ? "Mute notification sound" : "Unmute notification sound"}
            onClick={() => {
              const next = !sound;
              setSound(next);
              localStorage.setItem("azone-notif-sound", next ? "on" : "off");
              if (next) void chime(); // audible confirmation (gesture context — always plays now)
            }}
          >
            {sound ? "🔊" : "🔇"}
          </button>
          {/* v1.6.0: push alerts to this device (works even with the tab
              closed). Hidden where the browser can't do web push. */}
          {pushState !== "unsupported" && (
            <button
              type="button"
              className={btnHdr}
              title={pushState === "granted" ? "Push alerts ON for this device — tap to turn off" : "Get push alerts on this device"}
              aria-label="Toggle push alerts"
              onClick={async () => {
                if (pushState === "granted") {
                  await disablePush();
                  setPushState("default");
                } else {
                  const r = await enablePush();
                  if (r === "ok") { setPushState("granted"); }
                  else if (r === "unconfigured") window.alert("Push isn't set up on the server yet — ask your admin to add the VAPID keys.");
                  else if (r === "denied") window.alert("Notifications are blocked for this site in your browser settings.");
                }
              }}
            >
              {pushState === "granted" ? "🔔✓" : "🔕"}
            </button>
          )}
          <button
            type="button"
            className={`${btnHdr} relative`}
            aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
            onClick={() => {
              setShowNotifs((v) => !v);
              if (unread) void api("/staff/notifications/read", { method: "POST", body: JSON.stringify({}) });
            }}
          >
            🔔
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white shadow">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button type="button" className={btnHdr} onClick={() => setDark((v) => !v)} aria-label="Toggle dark mode">
            {dark ? "☀️" : "🌙"}
          </button>
          <button
            type="button"
            className={`${btnHdr} whitespace-nowrap`}
            onClick={() => void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(() => setUser(null))}
          >
            Sign out
          </button>
        </div>
      </header>

      {showNotifs && (
        <div className={`${card} mt-4`}>
          <p className="text-sm font-semibold">Notifications</p>
          <p className="text-muted-foreground mt-0.5 text-xs">Last 7 days. Older notifications clear automatically.</p>
          {notifs.length === 0 && <p className="text-muted-foreground mt-2 text-sm">Nothing yet.</p>}
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
              <span className="text-muted-foreground text-xs">· {dmy(n.created_at)}</span>
            </p>
          ))}
          </div>
        </div>
      )}

      {/* v1.4.159 (CEO): every tab pill the SAME width; v1.4.187 (CEO: "tabs
          width was not same with card width"): the rows now form a full-width
          GRID — equal columns filling the container exactly, so the pill rows
          are flush with the card edges below (v1.4.213: 17 tabs — the second row
          8). Same standard in /admin and /account. */}
      <nav className="mt-6 hidden gap-2 md:grid" aria-label="Portal sections"
        style={{ gridTemplateColumns: `repeat(${Math.min(tabs.length, 8)}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "bg-primary text-primary-foreground inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium"
                : "inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-border px-2 py-1.5 text-sm hover:bg-secondary"
            }
          >
            {tabLabel(t)}
          </button>
        ))}
      </nav>

      {/* App-style bottom navigation (v1.4.49) — phones only. The first four
          of this person's tabs are one thumb-tap away; the rest are in More. */}
      <nav
        className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Portal sections (mobile)"
      >
        {tabs.slice(0, 4).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium ${
              tab === t && !moreOpen ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <span className={`h-1 w-6 rounded-full ${tab === t && !moreOpen ? "bg-gold-deep" : "bg-transparent"}`} />
            {t === "Staff Details" ? "Staff" : t === "Announcements" ? "News" : t}
          </button>
        ))}
        {tabs.length > 4 && (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium ${
              moreOpen || tabs.indexOf(tab) >= 4 ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <span className={`h-1 w-6 rounded-full ${moreOpen || tabs.indexOf(tab) >= 4 ? "bg-gold-deep" : "bg-transparent"}`} />
            More
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 cursor-pointer bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="border-border bg-card absolute inset-x-0 bottom-0 rounded-t-2xl border-t p-4 pb-16">
            <div className="mb-3 flex items-center justify-between">
              <span className="w-9" />
              <button
                type="button"
                aria-label="Close menu"
                className="bg-border mx-auto h-1.5 w-12 rounded-full"
                onClick={() => setMoreOpen(false)}
              />
              <button
                type="button"
                aria-label="Close"
                className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                onClick={() => setMoreOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {tabs.slice(4).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
                  className={`min-h-14 rounded-lg border px-2 py-3 text-xs font-medium ${
                    tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                  }`}
                >
                  {tabLabel(t)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main key={tab} className="screen-enter mt-4 md:mt-6">
        {activeTab === "Dashboard" && <Dashboard user={user} go={setTab} />}
        {activeTab === "Claims" && <ClaimsPanel userId={user.id} role={user.role} />}
        {activeTab === "Expenses" && (
          <div className="space-y-4 md:space-y-6">
            <PnlCard />
            <ExpensesPanel />
          </div>
        )}
        {activeTab === "Attendance" && (
          <div className="space-y-4 md:space-y-6">
            <Attendance user={user} />
            {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? <OtApprovalsCard /> : <PermissionPlaceholder title="OT Approvals" />}
            <LiveScheduleCard user={user} />
            {["ceo", "super_admin", "admin"].includes(user.role) ? <AttendanceAdminPanel /> : <PermissionPlaceholder title="Attendance Admin" />}
          </div>
        )}
        {activeTab === "Leave" && <Leave user={user} />}
        {activeTab === "Tasks" && <Tasks user={user} />}
        {activeTab === "Announcements" && <Announcements user={user} />}
        {activeTab === "Sales" && SALES_ROLES.includes(user.role) && (
          <div className="space-y-4 md:space-y-6">
            <Sales user={user} />
            <ClientsCard />
            <LiveEconomicsCard />
            <PackagesEditorCard role={user.role} />
            <CustomerEnquiriesCard />
          </div>
        )}
        {activeTab === "HR" && (
          <div className="space-y-4 md:space-y-6">
            <HrPanel />
            {["hr_admin", "ceo", "super_admin", "admin"].includes(user.role) ? <HrAdminPanel /> : <PermissionPlaceholder title="HR Administration" />}
          </div>
        )}
        {activeTab === "Payroll" && <PayrollPanel />}
        {activeTab === "Staff Details" && <StaffDirectory canAmend={["super_admin", "admin", "ceo"].includes(user.role)} readOnly={["coo", "cco"].includes(user.role)} />}
        {activeTab === "Inventory" && <InventoryPanel role={user.role} />}
        {activeTab === "Ecommerce" && (
          <div className="space-y-3 md:space-y-6">
            {/* v1.4.214 (CEO): every TikTok / e-commerce card in one place —
                connection health, the order tracker, LIVE GMV, the hourly
                histogram and the fulfilment pipeline. */}
            {/* v1.4.217 (CEO's order): Orders → GMV → by-hour → Fulfilment
                → Connection status last (plumbing below the business).
                v1.4.277: Sales revenue leads the tab (moved from Dashboard
                per CEO — the month summary above the channel detail). */}
            {REVENUE_ROLES.includes(user.role) && <LeaderboardCard user={user} />}
            {TARGET_ADMIN_ROLES.includes(user.role) && <TargetsCommissionCard />}
            {REVENUE_ROLES.includes(user.role) && <SalesHistoryCard />}
            {REVENUE_ROLES.includes(user.role) && <SalesRevenueCard />}
            {REVENUE_ROLES.includes(user.role) && <BusinessLinesCard />}
            <TikTokOrdersCard role={user.role} onChanged={() => { /* stock views live on Inventory */ }} />
            <LiveGmvCard />
            {REVENUE_ROLES.includes(user.role) && <SalesByHourCard />}
            {REVENUE_ROLES.includes(user.role) && <FulfilmentCard />}
            <ConnectionStatusCard />
          </div>
        )}
        {/* v1.5.0: Social tab removed on the CEO's direction. */}
        {activeTab === "Assets" && <AssetsPanel />}
        {activeTab === "Birthdays" && <BirthdaysPanel />}
        {activeTab === "Overview" && <OverviewPanel />}
        {activeTab === "Users" && (
          <div className="space-y-4 md:space-y-6">
            {["ceo", "super_admin"].includes(user.role) && <TabAccessCard />}
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
              <a className="underline" href="/privacy" target="_blank" rel="noopener noreferrer">How your personal data is handled — Privacy Notice (PDPA)</a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
