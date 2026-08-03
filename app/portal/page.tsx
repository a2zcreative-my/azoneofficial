"use client";

/**
 * AZ ONE OFFICIAL — Staff Portal v1 (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 * Modules: Dashboard, Attendance, Leave, Tasks, Announcements, Sales, Profile,
 * plus role modules (v1.4.4): HR, Inventory, Commercial, Operations, Overview.
 * Desktop-first, responsive; light/dark mode.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { properName, firstName } from "@/lib/names";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { useSaveToast } from "@/components/ui/save-toast";
import { HrAdminPanel } from "@/components/admin/hr-admin-panel";
import { MyPayslip, PayrollPanel } from "@/components/portal/payroll-panel";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import {
  AttendanceAdminPanel,
  BirthdaysPanel,
  HrPanel,
  InventoryPanel,
  OverviewPanel,
  ClaimsPanel,
  ExpensesPanel,
} from "@/components/portal/role-panels";
import { StaffDirectory } from "@/components/staff/staff-directory";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string; photo_key?: string | null }

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, status: res.status, data: (res.status === 204 ? null : await res.json()) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50";
const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";
const card = "rounded-lg border border-border bg-card p-3.5 md:p-4";
// v1.4.146: header controls — compact on phones so avatar + title + all four
// controls share ONE row (the old full-size buttons wrapped to a second row
// and pushed the whole screen down).
const btnHdr =
  "inline-flex h-8 items-center justify-center rounded-lg border border-border px-2 text-sm font-medium transition-colors hover:bg-secondary md:h-9 md:px-3";

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
function mytToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
function mytDateOf(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
}

const MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]; // v1.4.153: CEO posts news too
const SALES_ROLES = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"];

function fmtRM(cents: number) {
  return `RM ${(cents / 100).toFixed(2)}`;
}

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
function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  const date = `${d[2]}-${d[1]}-${d[0]}`;
  const time = iso.length >= 16 ? ` ${iso.slice(11, 16)}` : "";
  return date + time;
}

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

      {REVENUE_ROLES.includes(user.role) && <SalesRevenueCard role={user.role} />}

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
  other?: { this_cents: number; this_orders: number; last_cents: number; last_orders: number };  // v1.4.169 non-TikTok shipments
  manual?: { this_cents: number; this_units: number; last_cents: number; last_units: number };   // v1.4.169 manual sales
  tiktok: { this_cents: number; this_orders: number; last_cents: number; last_orders: number };
  invoiced: { this_cents: number; this_docs: number; last_cents: number; last_docs: number };  outstanding?: { cents: number; docs: number };
  target_cents?: number | null;
  next_month?: string;
  last_target_cents?: number | null;
  next_target_cents?: number | null;
}

/** Sales revenue at a glance — TikTok order amounts (captured by the sync)
    plus invoices issued, this month vs last. */
function SalesRevenueCard({ role }: { role?: string }) {
  const [rev, setRev] = useState<RevenueData | null>(null);
  const loadRev = useCallback(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => { if (r.ok && r.data) setRev(r.data); });
  }, []);
  useEffect(() => { loadRev(); }, [loadRev]);
  const canTarget = ["super_admin", "admin", "ceo", "coo"].includes(role ?? "");
  // v1.4.93: inline target editor — no more browser prompt() box.
  const [editingTarget, setEditingTarget] = useState<null | "this" | "next">(null);
  const [targetDraft, setTargetDraft] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast();
  if (!rev) return null;
  const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      {toastNode}
      <p className="text-sm font-semibold">Sales revenue — {rev.month}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        TikTok figures from synced order amounts (returned orders excluded).
        Invoiced figures count PAYMENTS RECEIVED (paid invoices, in the month
        the payment landed) — comparable with Expenses. Since v1.4.169 the
        Total also counts non-TikTok shipments (order amount on the postage
        form) and manual sales (an Out − with a sold price) — every channel,
        one number, and the KPI below tracks it.
      </p>
      {/* v1.4.156 (CEO: "show today sales to motivate my Sales team") —
          today leads the grid with the brand-gold accent. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rev.today && (() => {
          const todayTotal = rev.today.tiktok_cents + rev.today.invoiced_cents + (rev.today.other_cents ?? 0) + (rev.today.manual_cents ?? 0);
          return (
            <div className="rounded-lg border-2 border-[#C9A227] bg-[#C9A227]/5 p-3">
              <p className="text-xs font-semibold tracking-wide text-[#8a6f1a] uppercase dark:text-[#C9A227]">🔥 Today · {rev.today.date.split("-").reverse().join("-")}</p>
              <p className="mt-1 text-xl font-semibold">{rm(todayTotal)}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {rev.today.tiktok_orders} TikTok order{rev.today.tiktok_orders === 1 ? "" : "s"}
                {rev.today.invoiced_cents > 0 ? ` · invoiced ${rm(rev.today.invoiced_cents)}` : ""}
                {(rev.today.other_cents ?? 0) > 0 ? ` · other shipments ${rm(rev.today.other_cents ?? 0)}` : ""}
                {(rev.today.manual_cents ?? 0) > 0 ? ` · manual sales ${rm(rev.today.manual_cents ?? 0)}` : ""}
                {todayTotal === 0 ? " — let's open the account! 💪" : " — keep it rolling! 💪"}
              </p>
            </div>
          );
        })()}
        {box("TikTok Shop", rm(rev.tiktok.this_cents), `${rev.tiktok.this_orders} orders · last month ${rm(rev.tiktok.last_cents)}`)}
        {box("Invoiced (paid)", rm(rev.invoiced.this_cents), `${rev.invoiced.this_docs} paid · last month ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · outstanding ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`)}
        {/* v1.4.169: the other two channels, so the Total is ALL sales */}
        {box("Other shipments", rm(rev.other?.this_cents ?? 0), `${rev.other?.this_orders ?? 0} non-TikTok order${(rev.other?.this_orders ?? 0) === 1 ? "" : "s"} with amount · last month ${rm(rev.other?.last_cents ?? 0)}`)}
        {box("Manual sales", rm(rev.manual?.this_cents ?? 0), `${rev.manual?.this_units ?? 0} unit${(rev.manual?.this_units ?? 0) === 1 ? "" : "s"} sold via Out − · last month ${rm(rev.manual?.last_cents ?? 0)}`)}
        {box("Total — all channels", rm(total), delta === null ? `last month ${rm(lastTotal)}` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`)}
      </div>
      <div className="border-border mt-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide uppercase">🎯 Monthly sales target (KPI)</p>
          {canTarget && !editingTarget && (
            <button type="button" className="text-xs underline" onClick={() => { setTargetDraft(rev.target_cents ? (rev.target_cents / 100).toString() : ""); setEditingTarget("this"); }}>
              {rev.target_cents ? "Edit target" : "Set target"}
            </button>
          )}
        </div>
        {editingTarget && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">Target for {(editingTarget === "next" ? (rev.next_month ?? rev.month) : rev.month).split("-").reverse().join("-")}:</span>
            <span className="flex items-center gap-1 text-sm">
              RM
              <input type="number" min={0} step="0.01" autoFocus
                className="border-input bg-background h-9 w-36 rounded-lg border px-2 text-sm"
                placeholder="e.g. 20000" value={targetDraft}
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingTarget(null); }} />
            </span>
            <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
              onClick={async () => {
                const v = Number(targetDraft);
                const m = editingTarget === "next" ? (rev.next_month ?? rev.month) : rev.month;
                const current = editingTarget === "next" ? (rev.next_target_cents ?? 0) : (rev.target_cents ?? 0);
                if (!v || v <= 0) { showToast("No changes", "Enter a target amount first", "notice"); return; }
                if (Math.round(v * 100) === current) { showToast("No changes", "Target unchanged", "notice"); setEditingTarget(null); return; }
                const res = await api(`/staff/revenue/target`, { method: "POST", body: JSON.stringify({ month: m, target_cents: Math.round(v * 100) }) });
                if (res.ok) { showToast("Saved", `Sales target for ${m.split("-").reverse().join("-")} — RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`); setEditingTarget(null); loadRev(); }
              }}>
              Save target
            </button>
            <button type="button" className="text-xs underline" onClick={() => setEditingTarget(null)}>Cancel</button>
          </div>
        )}
        {rev.target_cents ? (() => {
          const pct = Math.min(100, Math.round((total / rev.target_cents) * 100));
          // v1.4.160 (CEO: indicator colour to hit the target + a percentage
          // progress bar): traffic-light tiers plus an on-pace check against
          // how far through the month we are (MYT).
          const nowM = new Date(Date.now() + 8 * 3600 * 1000);
          const daysInMonth = new Date(Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() + 1, 0)).getUTCDate();
          const expectedPct = Math.round((nowM.getUTCDate() / daysInMonth) * 100);
          const barColor = pct >= 100 ? "bg-green-600" : pct >= 70 ? "bg-[#C9A227]" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
          const onPace = pct >= expectedPct;
          return (
            <>
              <div className="mt-2 relative h-5 w-full overflow-hidden rounded-full bg-secondary">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(pct, 1)}%` }} />
                <span className={`absolute inset-0 flex items-center text-[11px] font-bold ${pct >= 12 ? "justify-start pl-2 text-white" : "justify-start text-foreground"}`}
                  style={pct < 12 ? { paddingLeft: `calc(${Math.max(pct, 1)}% + 6px)` } : undefined}>
                  {pct}%
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="text-foreground font-semibold">{pct}%</span> of {rm(rev.target_cents)} achieved
                {" "}({rm(total)}{pct >= 100 ? " — 🎉 target hit!" : ` · ${rm(Math.max(0, rev.target_cents - total))} to go`})
              </p>
              {pct < 100 && (
                <p className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${onPace ? "bg-green-100 text-green-800" : expectedPct - pct <= 15 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                  {onPace ? "✅ On track" : "⚠ Behind pace"} — day {nowM.getUTCDate()}/{daysInMonth}: expected ~{expectedPct}% by today
                </p>
              )}
            </>
          );
        })() : (
          <p className="text-muted-foreground mt-1 text-xs">No target set for this month yet.</p>
        )}
        {rev.last_target_cents ? (() => {
          // v1.4.95: last month's KPI result stays visible this month — the
          // team sees where they landed, and the bar to beat.
          const lastPct = Math.round((lastTotal / rev.last_target_cents!) * 100);
          const hit = lastPct >= 100;
          return (
            <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${hit ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
              {hit ? "🏆" : "📈"} Last month ({rev.last_month.split("-").reverse().join("-")}): {rm(lastTotal)} of {rm(rev.last_target_cents!)} — {lastPct}%{" "}
              {hit ? "TARGET HIT — keep the streak going!" : "— this month is the comeback."}
            </p>
          );
        })() : null}
        {canTarget && !editingTarget && new Date(Date.now() + 8 * 3600 * 1000).getUTCDate() >= 25 && !rev.next_target_cents && rev.next_month && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            ⏰ Month-end soon — set {rev.next_month.split("-").reverse().join("-")}&apos;s target before the 30th/31st.{" "}
            <button type="button" className="underline" onClick={() => { setTargetDraft(""); setEditingTarget("next"); }}>Set next month&apos;s target</button>
          </p>
        )}
        {rev.next_target_cents ? (
          <p className="text-muted-foreground mt-2 text-xs">Next month&apos;s target already set: {rm(rev.next_target_cents)}.</p>
        ) : null}
      </div>
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
            {canManage && (
              <button type="button" className="text-destructive text-xs underline" onClick={() => void removeEvent(ev.id)}>Remove</button>
            )}
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
function EventsCalendar({ events, holidays, birthdays = [], month, onMonth, selected, onSelect, canManage, onRemove }: {
  events: CompanyEvent[];
  holidays: { holiday_date: string; name: string; kind: string }[];
  birthdays?: { name: string; birthday: string }[];
  month: string;
  onMonth: (m: string) => void;
  selected: string | null;
  onSelect: (d: string | null) => void;
  canManage: boolean;
  onRemove: (id: number) => void;
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
                {canManage && (
                  <button type="button" className="text-destructive text-xs underline" onClick={() => onRemove(ev.id)}>Remove</button>
                )}
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
    <div className="space-y-4">
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
            <p className="text-sm font-semibold">👁 Today&apos;s attendance monitor — {monitor.date.split("-").reverse().join("-")}</p>
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
            <div className="border-border divide-border mt-3 max-h-64 divide-y overflow-y-auto rounded-lg border">
              {[...monitor.staff].sort((a, b) => Number(!!a.in_at) - Number(!!b.in_at) || a.name.localeCompare(b.name)).map((st) => (
                <div key={st.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{properName(st.name)}</span>
                    <span className="text-muted-foreground text-xs capitalize"> · {st.role.replace(/_/g, " ")}{st.employment_status === "part_time" ? " (part-time)" : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
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
function Sub({ t, children }: { t: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{t}</span>
      {children}
    </label>
  );
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
    @page { size: A4; margin: 9mm; }
    * { box-sizing: border-box; }
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

function Leave({ user }: { user: User }) {
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
            <div key={l.id} className="border-border flex items-center justify-between border-b py-2 text-sm last:border-0">
              <span>
                {l.type} · {dmy(l.start_date)} → {dmy(l.end_date)} ({l.days}d) —{" "}
                <span className="font-medium">{STAGE_LABEL[(l as LeaveReq).stage ?? l.status] ?? l.status}</span>
                {l.review_comment ? <span className="text-muted-foreground"> · &quot;{l.review_comment}&quot;</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" className="text-xs underline" title="Print the Leave Application Form (AZOO-HR-LVE-001)" onClick={() => printLeaveForm(l, user.name)}>Print form</button>
                {!["approved", "rejected", "cancelled"].includes((l as LeaveReq).stage ?? "") && (
                  <button type="button" className="text-xs underline" onClick={() => void act(l.id, "cancel")}>Cancel</button>
                )}
              </span>
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

function Announcements({ user }: { user: User }) {
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState({ title: "", body: "", category: "news" });
  const canPost = MANAGE_ROLES.includes(user.role);

  const load = useCallback(async () => {
    const r = await api<{ announcements: Announcement[] }>(`/staff/announcements`);
    setAnns(r.data?.announcements ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async () => {
    if (!draft.title || !draft.body) return;
    await api(`/staff/announcements`, { method: "POST", body: JSON.stringify(draft) });
    setDraft({ title: "", body: "", category: "news" });
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
            <Sub t="Title">
              <input className={inputClass} placeholder="e.g. Perubahan waktu balik bekerja" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </Sub>
            <Sub t="Body">
              <textarea className={inputClass} rows={3} placeholder="The full announcement text" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
            </Sub>
            <Sub t="Category">
              <select className={`${inputClass} sm:max-w-44`} value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                {["news", "meeting", "holiday", "kpi", "training"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
          <p className="mt-2 text-sm whitespace-pre-wrap">{a.body}</p>
        </article>
      ))}
      </div>
      {anns.length === 0 && <p className="text-muted-foreground text-sm">No announcements yet.</p>}
    </div>
  );
}

/* ================= Sales (CRM + documents) ================= */

interface Customer { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null }
interface SalesDoc {
  id: number; doc_type: string; doc_number: string; company: string; total_cents: number;
  payment_status: string | null; delivery_status: string | null; created_at: string;
  payment_ref?: string | null; paid_at?: string | null; salesperson_name?: string | null;
  customer_id?: number; customer_phone?: string | null;
}

/** v1.4.101: printable Statement of Account per customer — same branded
    template family as the QT/DO/INV. Invoices only (paid + outstanding). */
function printSOA(company: string, docs: SalesDoc[]) {
  const invs = docs.filter((d) => d.doc_type === "INV" && d.company === company)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (invs.length === 0) return;
  const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    @page { size: A4; margin: 14mm; } * { box-sizing: border-box; }
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
    @media print { body { padding: 0; } }
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
interface DocItem { name: string; qty: number; unit_price_cents: number }


/** Fetch a full document and open a branded, print-ready PDF window. */
async function printDoc(id: number) {
  // v1.4.90: branded AZOO template for QT / DO / INV — navy + gold, doc-type
  // specific blocks (validity & acceptance for QT, received-in-good-order for
  // DO, payment details + PAID stamp for INV). Mobile-friendly: responsive
  // viewport for on-phone viewing, strict A4 when printed / saved to PDF.
  const res = await fetch(`/api/v1/staff/docs/${id}`, { credentials: "include" });
  if (!res.ok) return;
  const { doc } = (await res.json()) as { doc: DocFull };
  const items: { name: string; qty: number; unit_price_cents: number }[] = (() => {
    try { return JSON.parse(doc.items); } catch { return []; }
  })();
  const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const title = { QT: "QUOTATION", DO: "DELIVERY ORDER", INV: "INVOICE" }[doc.doc_type] ?? doc.doc_type;
  const dOnly = (v: string) => dmy(v.slice(0, 10)); // printed docs show dates without times
  const subtotal = items.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
  const taxAmt = Math.round((subtotal - (doc.discount_cents ?? 0)) * ((doc.tax_percent ?? 0) / 100));
  // v1.4.160: Malaysian standard — the DELIVERY ORDER lists goods and
  // quantities ONLY (no prices, no totals); it is proof of delivery, not a
  // bill. QT/INV keep full pricing and gain the Delivery / postage row.
  const isDO = doc.doc_type === "DO";
  const rows = items.map((it, i) => isDO
    ? `<tr>
      <td class="c">${i + 1}</td>
      <td>${it.name}</td>
      <td class="c">${it.qty}</td>
    </tr>`
    : `<tr>
      <td class="c">${i + 1}</td>
      <td>${it.name}</td>
      <td class="c">${it.qty}</td>
      <td class="r">${rm(it.unit_price_cents)}</td>
      <td class="r">${rm(it.qty * it.unit_price_cents)}</td>
    </tr>`).join("");
  const isPaid = doc.doc_type === "INV" && doc.payment_status === "paid";
  // v1.4.97: authorised signature auto-assigned by creator — the COO's own
  // documents carry the COO's signature; everyone else's (CEO, CCO, HR,
  // sales & marketing) carry the CEO's. Transparent PNGs incl. company chop.
  const sigSrc = `${location.origin}/signatures/${(doc.signer_role ?? (doc.created_by_role === "coo" ? "coo" : "ceo"))}-sign.png`;
  const sigImg = `<img src="${sigSrc}" alt="" style="height:112px;max-width:250px;object-fit:contain;display:block;margin:0 auto -16px;" />`;
  // Standardized signer identity under the line: FULL NAME → Position → company.
  const signerLines = `<div class="signer"><span class="nm">${(doc.signer_name ?? "").toUpperCase()}</span><br/>${doc.signer_position ?? ""}<br/><span class="tiny">AZ ONE OFFICIAL</span></div>`;
  const metaRows = [
    ["No.", doc.doc_number],
    ["Date", dOnly(doc.created_at)],
    ...(doc.doc_type === "QT" && doc.valid_until ? [["Valid until", dOnly(doc.valid_until)]] : []),
    ...(doc.doc_type === "INV" && doc.due_date ? [["Payment due", dOnly(doc.due_date)]] : []),
    ...(doc.doc_type === "INV" ? [["Terms", "Bank transfer"]] : []),
    ...(doc.salesperson_name ? [["Sales person", firstName(doc.salesperson_name)]] : []),
  ].map(([k, v]) => `<tr><td class="mk">${k}</td><td class="mv">${v}</td></tr>`).join("");

  const bottom = doc.doc_type === "INV"
    ? `<div class="split">
         <div class="pay">
           <p class="bt">PAYMENT DETAILS</p>
           <p>Method &nbsp;: <strong>Bank transfer</strong></p>
           <p>Bank &nbsp;&nbsp;&nbsp;&nbsp;: MAYBANK</p>
           <p>Name &nbsp;&nbsp;&nbsp;: AZ ONE OFFICIAL</p>
           <p>A/C No &nbsp;: <strong>5516 2328 7032</strong></p>
           <p class="tiny">Please send the transfer receipt via WhatsApp +60 12-383 4821 with the invoice number as reference.</p>
           ${isPaid ? `<p class="paidline">✔ PAID${doc.paid_at ? " · " + dOnly(doc.paid_at) : ""}${doc.payment_ref ? " · Ref: " + doc.payment_ref : ""}</p>` : ""}
         </div>
         <div class="sig">${sigImg}<div class="line"></div><span class="lbl">Authorised signature</span>${signerLines}</div>
       </div>`
    : doc.doc_type === "DO"
      ? `<div class="split">
           <div class="sig">${sigImg}<div class="line"></div><span class="lbl">Delivered by</span>${signerLines}</div>
           <div class="sig"><div class="line"></div>Received in good order<br/><span class="tiny">Name / Company chop &amp; date</span></div>
         </div>`
      : `<div class="split">
           <div class="pay">
             <p class="bt">TERMS</p>
             <p class="tiny">This quotation is valid ${doc.valid_until ? "until " + dOnly(doc.valid_until) : "for 14 days"}. Prices in RM. Work begins upon written acceptance${doc.tax_percent ? "" : "; prices exclude tax unless stated"}.</p>
           </div>
           <div class="split2">
             <div class="sig">${sigImg}<div class="line"></div><span class="lbl">Prepared by</span>${signerLines}</div>
             <div class="sig"><div class="line"></div>Accepted by<br/><span class="tiny">Signature, company chop &amp; date</span></div>
           </div>
         </div>`;

  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${doc.doc_number}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 12px; margin: 0; padding: 12px; max-width: 210mm; margin-inline: auto;
           display: flex; flex-direction: column; min-height: 268mm; } /* A4 minus @page margins — bottom block pinned to the page foot */
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; }
    .hd { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 14px 0 10px; border-bottom: 2.5px solid #1a2946; flex-wrap: wrap; }
    .brand { font-size: 19px; font-weight: 800; letter-spacing: .02em; }
    .brand small { display: block; font-size: 8px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    .brand .addr { font-size: 9.5px; color: #5b6472; font-weight: 400; letter-spacing: 0; margin-top: 6px; line-height: 1.5; }
    .docbox { text-align: right; min-width: 200px; }
    .docbox h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: .12em; color: #1a2946; }
    .meta { border-collapse: collapse; margin-left: auto; }
    .meta td { padding: 2px 0 2px 12px; font-size: 11px; text-align: right; }
    .meta .mk { color: #8a93a6; text-transform: uppercase; font-size: 9px; letter-spacing: .08em; }
    .meta .mv { font-weight: 700; }
    .parties { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .party { flex: 1; min-width: 220px; background: #f6f7fa; border-left: 3px solid #C9A227; border-radius: 6px; padding: 10px 12px; }
    .party .bt { margin: 0 0 4px; font-size: 9px; letter-spacing: .18em; color: #8a93a6; font-weight: 700; }
    .party p { margin: 2px 0; }
    .party .co { font-weight: 800; font-size: 13px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
    .items th { background: #1a2946; color: #fff; padding: 7px 9px; text-align: left; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
    .items th.c, .items td.c { text-align: center; width: 8%; }
    .items th.r, .items td.r { text-align: right; }
    .items td { padding: 7px 9px; border-bottom: 1px solid #e8ebf1; }
    .items tr:nth-child(even) td { background: #fafbfd; }
    .totwrap { display: flex; justify-content: flex-end; margin-top: 10px; }
    .tot { width: 260px; border-collapse: collapse; }
    .tot td { padding: 4px 10px; font-size: 12px; }
    .tot td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .tot tr.grand td { background: #1a2946; color: #fff; font-weight: 800; font-size: 14px; padding: 8px 10px; }
    .tot tr.grand td:first-child { border-radius: 6px 0 0 6px; } .tot tr.grand td:last-child { border-radius: 0 6px 6px 0; }
    .split { display: flex; gap: 16px; margin-top: auto; padding-top: 26px; justify-content: space-between; flex-wrap: wrap; align-items: flex-end; }
    /* margin-top:auto = the payment details + authorised signature sit at the
       BOTTOM of the A4 page on every document type, uniformly. */
    .split2 { display: flex; gap: 16px; flex: 1; justify-content: flex-end; flex-wrap: wrap; }
    .pay { background: #f6f7fa; border-radius: 6px; padding: 10px 12px; max-width: 320px; }
    .pay p { margin: 2px 0; }
    .pay .bt { font-size: 9px; letter-spacing: .18em; color: #8a93a6; font-weight: 700; }
    .paidline { color: #15803d; font-weight: 800; margin-top: 6px !important; }
    .sig { text-align: center; min-width: 200px; font-size: 10.5px; }
    .sig .line { border-bottom: 1px solid #1a2946; height: 18px; margin-bottom: 5px; }
    .sig .lbl { display: block; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #8a93a6; margin-bottom: 3px; }
    .signer .nm { font-weight: 800; font-size: 11.5px; letter-spacing: .02em; }
    .signer { line-height: 1.5; }
    .tiny { font-size: 9px; color: #8a93a6; }
    .foot { margin-top: 14px; font-size: 8.5px; color: #8a93a6; border-top: 1px solid #e8ebf1; padding-top: 8px; text-align: center; letter-spacing: .02em; }
    .notes { margin-top: 12px; font-size: 11px; color: #5b6472; white-space: pre-wrap; }
    .stamp { position: fixed; top: 34%; left: 50%; transform: translate(-50%,-50%) rotate(-18deg); border: 4px solid #15803d; color: #15803d; font-size: 44px; font-weight: 900; letter-spacing: .2em; padding: 6px 26px; border-radius: 10px; opacity: .18; pointer-events: none; }
    @media print { body { padding: 0; } }
  </style></head><body onload="window.print()">
  ${isPaid ? '<div class="stamp">PAID</div>' : ""}
  <div class="goldbar"></div>
  <div class="hd">
    <div class="brand">AZ ONE OFFICIAL
      <small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small>
      <div class="addr">Live Commerce Agency · SSM 202603168673 (JM1046169-H)<br/>
      34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika,<br/>
      81200 Johor Bahru, Johor, Malaysia<br/>
      admin@azoneofficial.com · WhatsApp +60 12-383 4821</div>
    </div>
    <div class="docbox"><h2>${title}</h2><table class="meta">${metaRows}</table></div>
  </div>
  <div class="parties">
    <div class="party">
      <p class="bt">${doc.doc_type === "DO" ? "DELIVER TO" : "BILL TO"}</p>
      <p class="co">${doc.company}</p>
      ${doc.contact_person ? `<p>${doc.contact_person}</p>` : ""}
      ${doc.address ? `<p>${doc.address}</p>` : ""}
      ${doc.customer_phone ? `<p>${doc.customer_phone}</p>` : ""}
      ${doc.customer_email ? `<p>${doc.customer_email}</p>` : ""}
    </div>
  </div>
  <table class="items">
    <thead><tr><th class="c">#</th><th>Description</th><th class="c">Qty</th>${isDO ? "" : '<th class="r">Unit price</th><th class="r">Amount</th>'}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${isDO ? 3 : 5}" style="padding:10px;color:#999">No line items</td></tr>`}</tbody>
  </table>
  ${isDO ? "" : `<div class="totwrap"><table class="tot">
    <tr><td>Subtotal</td><td>${rm(subtotal)}</td></tr>
    ${doc.discount_cents ? `<tr><td>Discount</td><td>− ${rm(doc.discount_cents)}</td></tr>` : ""}
    ${doc.tax_percent ? `<tr><td>Tax (${doc.tax_percent}%)</td><td>${rm(taxAmt)}</td></tr>` : ""}
    ${doc.delivery_cents ? `<tr><td>Delivery / postage</td><td>${rm(doc.delivery_cents)}</td></tr>` : ""}
    <tr class="grand"><td>TOTAL</td><td>${rm(doc.total_cents)}</td></tr>
  </table></div>`}
  ${doc.notes ? `<p class="notes">${doc.notes}</p>` : ""}
  ${bottom}
  <div class="foot">AZ ONE OFFICIAL · Empowering Brands Through Live Commerce and Digital Connections · azoneofficial.com<br/>
  This is a computer-generated document; no signature is required unless indicated above.</div>
  </body></html>`);
  w.document.close();
}

interface DocFull {
  doc_type: string; doc_number: string; company: string; contact_person?: string;
  address?: string; customer_phone?: string; customer_email?: string; items: string; discount_cents: number;
  tax_percent: number; delivery_cents?: number; total_cents: number; notes?: string; due_date?: string; valid_until?: string; created_at: string;
  payment_status?: string | null; payment_method?: string | null; payment_ref?: string | null; paid_at?: string | null;
  salesperson_name?: string | null;
  created_by_role?: string | null;
  signer_role?: string | null;
  signer_name?: string | null;
  signer_position?: string | null;
}

/* v1.4.181 (CEO: customers must be able to reach staff for package/service
   enquiries): the business team works those enquiries HERE, not only in
   /admin — newest first, category chips, status select, one-tap WhatsApp /
   email reply. */
function CustomerEnquiriesCard() {
  interface Enq { id: number; name: string; company?: string | null; phone?: string | null; email: string; message: string; category?: string | null; status: string; created_at: string }
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
                <span className="flex shrink-0 items-center gap-1.5 text-xs">
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
              <p className="text-muted-foreground mt-0.5 text-[10px]">{e.email} · {mytDateTime(e.created_at)} MYT</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sales({ user }: { user: User }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [cust, setCust] = useState({ company: "", contact_person: "", phone: "", email: "" });
  // customer_id: -1 = not chosen · 0 = walk-in/unidentified buyer.
  // salesperson_id: 0 = "me" (worker defaults to the creator).
  const [doc, setDoc] = useState<{ doc_type: string; customer_id: number; salesperson_id: number; items: DocItem[]; discount_cents: number; tax_percent: number; delivery_cents: number; paid_received: boolean }>({
    doc_type: "QT", customer_id: -1, salesperson_id: 0, items: [{ name: "", qty: 1, unit_price_cents: 0 }], discount_cents: 0, tax_percent: 0, delivery_cents: 0, paid_received: false,
  });
  const [staffList, setStaffList] = useState<{ id: number; name: string; role: string }[]>([]);
  const { show: showToast, node: toastNode } = useSaveToast();
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
    await api(`/staff/customers`, { method: "POST", body: JSON.stringify(cust) });
    setCust({ company: "", contact_person: "", phone: "", email: "" });
    void load();
  };
  const resetDocForm = () => {
    setDoc({ doc_type: "QT", customer_id: -1, salesperson_id: 0, items: [{ name: "", qty: 1, unit_price_cents: 0 }], discount_cents: 0, tax_percent: 0, delivery_cents: 0, paid_received: false });
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
      const res = await api<{ error?: { message?: string } }>(`/staff/docs/${editingDoc.id}/edit`, { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) { showToast("No changes", res.data?.error?.message ?? "Update failed — check access", "notice"); return; }
      showToast("Saved", `${editingDoc.doc_number} updated`);
      const idP = editingDoc.id;
      resetDocForm(); void load();
      void printDoc(idP); // fresh PDF straight after the fix
      return;
    }
    const res = await api<{ id?: number; doc_number?: string; error?: { message?: string } }>(`/staff/docs`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok || !res.data?.id) { showToast("No changes", res.data?.error?.message ?? "Create failed — check access", "notice"); return; }
    showToast("Saved", `${res.data.doc_number ?? "Document"} created${doc.paid_received ? " — PAID" : ""}`);
    const newId = res.data.id;
    resetDocForm();
    await load(); // v1.4.97: awaited so the new document is visible in the list at once
    void printDoc(newId); // PDF opens immediately after creation
  };
  const setStatus = async (d: SalesDoc, value: string, paymentRef?: string) => {
    const body = d.doc_type === "INV"
      ? value === "paid"
        ? { payment_status: "paid", payment_method: "bank_transfer", payment_ref: paymentRef || undefined }
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
          <p className="text-sm font-semibold">Add customer</p>
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
            <button type="button" className={btnClass} onClick={() => void addCustomer()}>Save customer</button>
          </div>
          <div className="mt-3 max-h-56 overflow-y-auto">
            {customers.length === 0 && (
              <p className="text-muted-foreground text-sm">No customers yet.</p>
            )}
            {customers.map((c) => (
              <div key={c.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                <span className="min-w-0">
                  <span className="font-medium">{c.company}</span>
                  {c.contact_person && (
                    <span className="text-muted-foreground"> · {c.contact_person}</span>
                  )}
                </span>
                {docs.some((d) => d.doc_type === "INV" && d.company === c.company) && (
                  <button type="button" className="border-border inline-flex h-7 shrink-0 items-center rounded-lg border px-2.5 text-xs hover:bg-secondary"
                    title="Statement of Account — all invoices, paid + outstanding, printable"
                    onClick={() => printSOA(c.company, docs)}>SOA</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          {toastNode}
          <p className="text-sm font-semibold">
            {editingDoc ? <>Editing {editingDoc.doc_number} <button type="button" className="ml-1 text-xs font-normal underline" onClick={resetDocForm}>cancel</button></> : "Create document"}
          </p>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs">Document type</span>
                <select className={inputClass} value={doc.doc_type} onChange={(e) => setDoc((d) => ({ ...d, doc_type: e.target.value }))}>
                  <option value="QT">Quotation</option>
                  <option value="DO">Delivery Order</option>
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
            <div className="text-muted-foreground grid grid-cols-[1fr_70px_110px_auto] gap-2 text-xs">
              <span>Item / service description</span><span>Qty</span><span>Unit price (RM)</span><span />
            </div>
            {doc.items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_110px_auto] items-center gap-2">
                <input className={inputClass} placeholder="e.g. Tudung Bawal Premium" value={item.name} list="inv-item-suggestions"
                  onChange={(e) => {
                    const v = e.target.value;
                    const hit = invItems.find((it) => it.name === v);
                    setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i
                      ? { ...x, name: v, unit_price_cents: hit?.unit_price_cents && !x.unit_price_cents ? hit.unit_price_cents : x.unit_price_cents }
                      : x) }));
                  }} />
                <input type="number" min={1} className={inputClass} value={item.qty}
                  onChange={(e) => setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i ? { ...x, qty: Number(e.target.value) } : x) }))} />
                <input type="number" min={0} step="0.01" className={inputClass} placeholder="0.00"
                  value={item.unit_price_cents ? (item.unit_price_cents / 100).toString() : ""}
                  onChange={(e) => setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i ? { ...x, unit_price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) } : x) }))} />
                {doc.items.length > 1
                  ? <button type="button" className="text-destructive text-xs underline" title="Remove this line"
                      onClick={() => setDoc((d) => ({ ...d, items: d.items.filter((_, xi) => xi !== i) }))}>✕</button>
                  : <span className="w-4" />}
              </div>
            ))}
            <datalist id="inv-item-suggestions">
              {invItems.map((it) => <option key={it.sku} value={it.name}>{`SKU ${it.sku}${it.unit_price_cents ? ` · RM ${(it.unit_price_cents / 100).toFixed(2)}` : ""}`}</option>)}
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
              {doc.doc_type !== "DO" && (
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
                const msg = encodeURIComponent(`Hi! Gentle reminder from AZ ONE OFFICIAL — invoice ${d.doc_number} (RM ${(d.total_cents / 100).toFixed(2)}) is still outstanding. Kindly settle by bank transfer to MAYBANK · AZ ONE OFFICIAL · A/C 5516 2328 7032, quoting the invoice number. Thank you!`);
                return (
                  <div key={d.id} className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-1.5 text-sm last:border-0">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="font-medium">{d.doc_number}</span> · {d.company} · {fmtRM(d.total_cents)}
                      <span className="text-muted-foreground"> · {n} days</span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
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
          <div key={d.id} className="border-border flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b py-2 text-sm last:border-0">
            {/* v1.4.100: standardized row — info left (grows), one aligned
                controls group right: chip · status · Edit · PDF, all h-7. */}
            <span className="min-w-0 flex-1 basis-64">
              <span className="font-medium">{d.doc_number}</span> · {d.company} · {fmtRM(d.total_cents)}
              <span className="text-muted-foreground"> · {dmy(d.created_at.slice(0, 10))}{d.salesperson_name ? ` · sales: ${firstName(d.salesperson_name)}` : ""}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {d.doc_type === "INV" && d.payment_status === "paid" && (
              <span className="inline-flex h-7 items-center rounded-full bg-green-100 px-2.5 text-xs font-semibold whitespace-nowrap text-green-700"
                title={`Payment received${d.paid_at ? " " + dmy(d.paid_at.slice(0, 10)) : ""}${d.payment_ref ? " · Ref " + d.payment_ref : ""}`}>
                PAID · bank transfer
              </span>
            )}
            {d.doc_type === "INV" && canInvoice && (
              <select className="border-input bg-background h-7 rounded-lg border px-2 text-xs" value={d.payment_status ?? "unpaid"}
                title="Mark paid when the bank transfer lands — revenue counts payments received"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "paid") {
                    const ref = window.prompt("Payment received — bank transfer reference (optional):", "") ?? undefined;
                    void setStatus(d, "paid", ref);
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
            {d.doc_type === "QT" && canInvoice && (
              <button type="button" className="inline-flex h-7 items-center rounded-lg bg-[#1A2946] px-2.5 text-xs font-medium text-white"
                title="One click Quotation → Invoice: same items, customer and sales person, fresh INV number"
                onClick={async () => {
                  const res = await api<{ id?: number; doc_number?: string; error?: { message?: string } }>(`/staff/docs/${d.id}/convert`, { method: "POST", body: JSON.stringify({}) });
                  if (!res.ok || !res.data?.id) { showToast("No changes", res.data?.error?.message ?? "Conversion failed — check access", "notice"); return; }
                  showToast("Saved", `${d.doc_number} → ${res.data.doc_number}`);
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
                });
                setDocDate(full.created_at.slice(0, 10));
                setEditingDoc({ id: d.id, doc_number: d.doc_number });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>Edit</button>
            <button type="button" className="border-border inline-flex h-7 items-center rounded-lg border px-2.5 text-xs hover:bg-secondary"
              onClick={() => void printDoc(d.id)}>PDF</button>
            </span>
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
            <span className="flex shrink-0 items-center gap-1">
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
              <span className="flex shrink-0 items-center gap-1">
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
              <span className="flex shrink-0 items-center gap-2">
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

// v1.4.101: order set by the CEO — Dashboard > News > HR > Staff Details >
// Attendance > Leave > (Tasks kept for task-only roles) > Claims > Payroll >
// Expenses > Sales > Inventory > Birthdays > Profile > Users
// (v1.4.143: CEO's revised order — Overview right after Dashboard).
const ALL_TABS = ["Dashboard", "Overview", "Announcements", "HR", "Staff Details", "Attendance", "Leave", "Tasks", "Claims", "Payroll", "Expenses", "Sales", "Inventory", "Birthdays", "Profile", "Users"] as const;
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
  Users: ["super_admin", "ceo", "coo"],
};
type TabName = (typeof ALL_TABS)[number];

export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<TabName>("Dashboard");
  const [dark, setDark] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
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
  useEffect(() => {
    setSound(localStorage.getItem("azone-notif-sound") !== "off");
  }, []);
  const audioRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef<number | null>(null); // null = first load (no chime)
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
    const fetchNotifs = () =>
      void api<{ notifications: Notification[] }>("/staff/notifications").then((r) => {
        const list = r.data?.notifications ?? [];
        const nowUnread = list.filter((n) => !n.is_read).length;
        // Chime only on an INCREASE after the first load — never on open,
        // never on mark-as-read shrinkage.
        if (unreadRef.current !== null && nowUnread > unreadRef.current &&
            localStorage.getItem("azone-notif-sound") !== "off") {
          void chime();
        }
        unreadRef.current = nowUnread;
        setNotifs(list);
      });
    fetchNotifs();
    // Live alerting (v1.4.31): announcements and assignments reach the bell
    // without a reload — poll every 60s and whenever the tab regains focus.
    const timer = window.setInterval(fetchNotifs, 60_000);
    window.addEventListener("focus", fetchNotifs);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", fetchNotifs);
    };
  }, [user, tab, chime]);

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

  const unread = notifs.filter((n) => !n.is_read).length;
  const tabs = ALL_TABS.filter((t) => {
    if (t === "Sales") return SALES_ROLES.includes(user.role) || user.role === "ceo";
    const allowed = TAB_ROLES[t];
    return !allowed || allowed.includes(user.role);
  });

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

      {/* v1.4.159 (CEO): every tab pill is the SAME fixed width (w-32) as the
          Dashboard pill — uniform app-style grid instead of text-sized pills.
          Same standard applied in /admin and /account. */}
      <nav className="mt-6 hidden gap-2 md:flex md:flex-wrap" aria-label="Portal sections">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "bg-primary text-primary-foreground inline-flex w-32 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium"
                : "inline-flex w-32 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-border px-2 py-1.5 text-sm hover:bg-secondary"
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
        {tab === "Dashboard" && <Dashboard user={user} go={setTab} />}
        {tab === "Claims" && <ClaimsPanel userId={user.id} role={user.role} />}
        {tab === "Expenses" && <ExpensesPanel />}
        {tab === "Attendance" && (
          <>
            <Attendance user={user} />
            {["ceo", "super_admin", "admin"].includes(user.role) && <AttendanceAdminPanel />}
          </>
        )}
        {tab === "Leave" && <Leave user={user} />}
        {tab === "Tasks" && <Tasks user={user} />}
        {tab === "Announcements" && <Announcements user={user} />}
        {tab === "Sales" && SALES_ROLES.includes(user.role) && (<><Sales user={user} /><CustomerEnquiriesCard /></>)}
        {tab === "HR" && (
          <>
            <HrPanel />
            {["hr_admin", "ceo", "super_admin", "admin"].includes(user.role) && <HrAdminPanel />}
          </>
        )}
        {tab === "Payroll" && <PayrollPanel />}
        {tab === "Staff Details" && <StaffDirectory canAmend={["super_admin", "admin", "ceo"].includes(user.role)} readOnly={["coo", "cco"].includes(user.role)} />}
        {tab === "Inventory" && <InventoryPanel role={user.role} />}
        {tab === "Birthdays" && <BirthdaysPanel />}
        {tab === "Overview" && <OverviewPanel />}
        {tab === "Users" && <UsersPanel role={user.role} />}
        {tab === "Profile" && (
          <div className="space-y-4 md:space-y-6">
            <Profile />
            <MyPayslip />
            <TwoFactorPanel />
          </div>
        )}
      </main>
    </div>
  );
}
