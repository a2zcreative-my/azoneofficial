"use client";

/**
 * AZ ONE OFFICIAL — Staff Portal v1 (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 * Modules: Dashboard, Attendance, Leave, Tasks, Announcements, Sales, Profile,
 * plus role modules (v1.4.4): HR, Inventory, Commercial, Operations, Overview.
 * Desktop-first, responsive; light/dark mode.
 */

import { useCallback, useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
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
} from "@/components/portal/role-panels";
import { StaffDirectory } from "@/components/staff/staff-directory";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }

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

const MANAGE_ROLES = ["super_admin", "admin", "hr_admin", "coo", "cco"];
const SALES_ROLES = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"];

function fmtRM(cents: number) {
  return `RM ${(cents / 100).toFixed(2)}`;
}

/* ================= Dashboard ================= */

interface Notification { id: number; kind: string; message: string; is_read: number; created_at: string }
interface Task { id: number; title: string; priority: string; deadline: string | null; status: string; progress: number; assignee?: string }
interface Announcement { id: number; title: string; body: string; category: string; created_at: string; acked: number }
interface LeaveReq { id: number; type: string; start_date: string; end_date: string; days: number; status: string; stage?: string; applicant_role?: string; user_id?: number; user_name?: string; review_comment?: string | null }

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
  const [leave, setLeave] = useState<LeaveReq[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const a = await api<{ records: { type: string; created_at: string }[] }>(`/staff/attendance?month=${month}`);
    setToday((a.data?.records ?? []).filter((r) => mytDateOf(r.created_at) === mytToday()));
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
    } else {
      setPunchError(res.data?.error?.message ?? "Punch failed — try again.");
    }
    void load();
  };

  const hasIn = today.some((r) => r.type === "clock_in");
  const hasOut = today.some((r) => r.type === "clock_out");

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnClass} disabled={!!busy} onClick={() => void punch("clock_in")}>
            {hasIn ? "Clocked in ✓" : "Clock in"}
          </button>
          <button type="button" className={btnGhost} disabled={!!busy} onClick={() => void punch("clock_out")}>
            {hasOut ? "Clocked out ✓" : "Clock out"}
          </button>
          <button type="button" className={btnGhost} onClick={() => go("Leave")}>Apply leave</button>
          {SALES_ROLES.includes(user.role) && (
            <button type="button" className={btnGhost} onClick={() => go("Sales")}>Create quotation</button>
          )}
        </div>
        {punchError && <p className="text-destructive mt-2 text-xs font-medium">{punchError}</p>}
        {punchToast && <PunchToast title={punchToast.title} sub={punchToast.sub} variant={punchToast.variant} />}
        <p className="text-muted-foreground mt-3 text-xs">
          {today.length === 0
            ? "No attendance recorded today."
            : `Today: ${today.slice().reverse().map((r) => `${r.type.replace("_", " ")} ${mytTime(r.created_at)}`).join(" · ")}`}
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
            Announcements
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

      {REVENUE_ROLES.includes(user.role) && <SalesRevenueCard />}

      <UpcomingEventsCard role={user.role} />
    </div>
  );
}

/* ================= Sales revenue (v1.4.75) ================= */

const REVENUE_ROLES = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

interface RevenueData {
  month: string;
  last_month: string;
  tiktok: { this_cents: number; this_orders: number; last_cents: number; last_orders: number };
  invoiced: { this_cents: number; this_docs: number; last_cents: number; last_docs: number };
}

/** Sales revenue at a glance — TikTok order amounts (captured by the sync)
    plus invoices issued, this month vs last. */
function SalesRevenueCard() {
  const [rev, setRev] = useState<RevenueData | null>(null);
  useEffect(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => { if (r.ok && r.data) setRev(r.data); });
  }, []);
  if (!rev) return null;
  const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const total = rev.tiktok.this_cents + rev.invoiced.this_cents;
  const lastTotal = rev.tiktok.last_cents + rev.invoiced.last_cents;
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
        TikTok figures come from synced order amounts (returned orders excluded);
        invoiced figures from INV documents in the Sales module.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {box("TikTok Shop", rm(rev.tiktok.this_cents), `${rev.tiktok.this_orders} orders · last month ${rm(rev.tiktok.last_cents)}`)}
        {box("Invoiced", rm(rev.invoiced.this_cents), `${rev.invoiced.this_docs} invoices · last month ${rm(rev.invoiced.last_cents)}`)}
        {box("Total", rm(total), delta === null ? `last month ${rm(lastTotal)}` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`)}
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

  // v1.4.81: Johor public holidays render on the calendar too.
  const [holidays, setHolidays] = useState<{ holiday_date: string; name: string; kind: string }[]>([]);

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
    void loadEvents();
  };

  const removeEvent = async (id: number) => {
    await api(`/staff/events/${id}`, { method: "DELETE" });
    void loadEvents();
  };

  return (
    <div className={card}>
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
          <input className={inputClass} placeholder="Event title (e.g. TikTok Live hosting training)" value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <div className="flex flex-wrap gap-2">
            <select className={`${inputClass} max-w-40`} value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
              {EVENT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" className={`${inputClass} max-w-44`} value={draft.event_date}
              onChange={(e) => setDraft((d) => ({ ...d, event_date: e.target.value }))} />
            <input type="time" className={`${inputClass} max-w-32`} value={draft.start_time} title="Start time (optional)"
              onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} />
            <input type="time" className={`${inputClass} max-w-32`} value={draft.end_time} title="End time (optional)"
              onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} />
          </div>
          <input className={inputClass} placeholder="Location (optional)" value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
          <textarea className={`${inputClass} min-h-16`} placeholder="Details (optional)" value={draft.details}
            onChange={(e) => setDraft((d) => ({ ...d, details: e.target.value }))} />
          {msg && <p className="text-destructive text-xs font-medium">{msg}</p>}
          <button type="button" className={btnClass} onClick={() => void createEvent()}>Save event — notifies all staff</button>
        </div>
      )}
      {view === "calendar" && (
        <EventsCalendar
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
function EventsCalendar({ events, holidays, month, onMonth, selected, onSelect, canManage, onRemove }: {
  events: CompanyEvent[];
  holidays: { holiday_date: string; name: string; kind: string }[];
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

  useEffect(() => {
    const path = reportMode && canReport ? `/staff/attendance/report?month=${month}` : `/staff/attendance?month=${month}`;
    void api<{ records: typeof records }>(path).then((r) => setRecords(r.data?.records ?? []));
  }, [month, reportMode, canReport]);

  return (
    <div className="space-y-4">
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
              <select className="border-input bg-background h-9 max-w-44 rounded-lg border px-2 text-sm" value={filterName}
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
                    <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">In</th>
                    <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Out</th>
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
                          {lastOut ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{mytTime(lastOut)}</span> : <span className="text-muted-foreground text-xs">still in / missing</span>}
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
            <select className={inputClass} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" className={inputClass} value={draft.start_date} onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))} />
              <input type="date" className={inputClass} value={draft.end_date} onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))} />
            </div>
            <input type="number" min={0.5} step={0.5} className={inputClass} value={draft.days} onChange={(e) => setDraft((d) => ({ ...d, days: Number(e.target.value) }))} />
            <textarea className={inputClass} rows={2} placeholder="Reason (optional)" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
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
              {!["approved", "rejected", "cancelled"].includes((l as LeaveReq).stage ?? "") && (
                <button type="button" className="text-xs underline" onClick={() => void act(l.id, "cancel")}>Cancel</button>
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
          <input className={inputClass} placeholder="Title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <textarea className={inputClass} rows={2} placeholder="Description" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          {canManage && (
            <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: Number(e.target.value) }))}>
              <option value={0}>Assign to myself</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-3">
            <select className={inputClass} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
              {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" className={inputClass} value={draft.deadline} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
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
          <p className="text-sm font-semibold">Publish announcement</p>
          <div className="mt-3 space-y-3">
            <input className={inputClass} placeholder="Title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            <textarea className={inputClass} rows={3} placeholder="Body" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
            <select className={inputClass} value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
              {["news", "meeting", "holiday", "kpi", "training"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
interface SalesDoc { id: number; doc_type: string; doc_number: string; company: string; total_cents: number; payment_status: string | null; delivery_status: string | null; created_at: string }
interface DocItem { name: string; qty: number; unit_price_cents: number }


/** Fetch a full document and open a branded, print-ready PDF window. */
async function printDoc(id: number) {
  const res = await fetch(`/api/v1/staff/docs/${id}`, { credentials: "include" });
  if (!res.ok) return;
  const { doc } = (await res.json()) as { doc: DocFull };
  const items: { name: string; qty: number; unit_price_cents: number }[] = (() => {
    try { return JSON.parse(doc.items); } catch { return []; }
  })();
  const rm = (c: number) => `RM ${(c / 100).toFixed(2)}`;
  const title = { QT: "QUOTATION", DO: "DELIVERY ORDER", INV: "INVOICE" }[doc.doc_type] ?? doc.doc_type;
  const rows = items.map((it) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${it.name}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${rm(it.unit_price_cents)}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${rm(it.qty * it.unit_price_cents)}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${doc.doc_number}</title>
  <style>@page{size:A4;margin:16mm}body{font-family:Arial,Helvetica,sans-serif;color:#1a2946;font-size:12px}
  .hd{display:flex;justify-content:space-between;border-bottom:2px solid #1a2946;padding-bottom:10px}
  .brand{font-size:15px;font-weight:800}.brand small{display:block;font-size:8px;letter-spacing:.3em;color:#b8912f}
  .doc{text-align:right}.doc h2{margin:0;font-size:18px;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{background:#1a2946;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase}
  .tot{margin-top:10px;width:100%;text-align:right}.tot td{padding:3px 8px}
  .party{margin-top:16px;color:#5b6472}.foot{margin-top:28px;font-size:9px;color:#8a93a6;border-top:1px solid #eee;padding-top:8px}</style>
  </head><body onload="window.print()">
  <div class="hd">
    <div class="brand">AZ ONE OFFICIAL<small>LIVE COMMERCE AGENCY</small></div>
    <div class="doc"><h2>${title}</h2><div>${doc.doc_number}</div>
      <div style="color:#5b6472">${dmy(doc.created_at)}</div></div>
  </div>
  <div class="party"><strong>To:</strong> ${doc.company}${doc.contact_person ? " · " + doc.contact_person : ""}<br/>
    ${doc.address ?? ""}${doc.customer_phone ? "<br/>" + doc.customer_phone : ""}</div>
  <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="padding:8px;color:#999">No line items</td></tr>'}</tbody></table>
  <table class="tot">
    ${doc.discount_cents ? `<tr><td>Discount</td><td>- ${rm(doc.discount_cents)}</td></tr>` : ""}
    ${doc.tax_percent ? `<tr><td>Tax</td><td>${doc.tax_percent}%</td></tr>` : ""}
    <tr><td style="font-weight:800;font-size:14px">TOTAL</td><td style="font-weight:800;font-size:14px">${rm(doc.total_cents)}</td></tr>
  </table>
  ${doc.notes ? `<p class="party">${doc.notes}</p>` : ""}
  <div class="foot">AZ ONE OFFICIAL · SSM 202603168673 (JM1046169-H) · azoneofficial.com · WhatsApp +60 12-383 4821${doc.doc_type === "INV" && doc.due_date ? " · Due: " + doc.due_date : ""}</div>
  </body></html>`);
  w.document.close();
}

interface DocFull {
  doc_type: string; doc_number: string; company: string; contact_person?: string;
  address?: string; customer_phone?: string; items: string; discount_cents: number;
  tax_percent: number; total_cents: number; notes?: string; due_date?: string; created_at: string;
}

function Sales({ user }: { user: User }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  const [cust, setCust] = useState({ company: "", contact_person: "", phone: "", email: "" });
  const [doc, setDoc] = useState<{ doc_type: string; customer_id: number; items: DocItem[]; discount_cents: number; tax_percent: number }>({
    doc_type: "QT", customer_id: 0, items: [{ name: "", qty: 1, unit_price_cents: 0 }], discount_cents: 0, tax_percent: 0,
  });
  const canInvoice = ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo", "sales_marketing"].includes(user.role);

  const load = useCallback(async () => {
    const c = await api<{ customers: Customer[] }>(`/staff/customers`);
    setCustomers(c.data?.customers ?? []);
    const d = await api<{ docs: SalesDoc[] }>(`/staff/docs`);
    setDocs(d.data?.docs ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const addCustomer = async () => {
    if (!cust.company) return;
    await api(`/staff/customers`, { method: "POST", body: JSON.stringify(cust) });
    setCust({ company: "", contact_person: "", phone: "", email: "" });
    void load();
  };
  const createDoc = async () => {
    if (!doc.customer_id || doc.items.some((i) => !i.name)) return;
    await api(`/staff/docs`, { method: "POST", body: JSON.stringify(doc) });
    setDoc({ doc_type: "QT", customer_id: 0, items: [{ name: "", qty: 1, unit_price_cents: 0 }], discount_cents: 0, tax_percent: 0 });
    void load();
  };
  const setStatus = async (d: SalesDoc, value: string) => {
    const body = d.doc_type === "INV" ? { payment_status: value } : { delivery_status: value };
    await api(`/staff/docs/${d.id}`, { method: "PATCH", body: JSON.stringify(body) });
    void load();
  };

  const subtotal = doc.items.reduce((s, i) => s + i.qty * i.unit_price_cents, 0);
  const total = Math.max(0, Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100)));

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">Add customer</p>
          <div className="mt-3 space-y-3">
            <input className={inputClass} placeholder="Company *" value={cust.company} onChange={(e) => setCust((c) => ({ ...c, company: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <input className={inputClass} placeholder="Contact person" value={cust.contact_person} onChange={(e) => setCust((c) => ({ ...c, contact_person: e.target.value }))} />
              <input className={inputClass} placeholder="Phone" value={cust.phone} onChange={(e) => setCust((c) => ({ ...c, phone: e.target.value }))} />
            </div>
            <input className={inputClass} placeholder="Email" value={cust.email} onChange={(e) => setCust((c) => ({ ...c, email: e.target.value }))} />
            <button type="button" className={btnClass} onClick={() => void addCustomer()}>Save customer</button>
          </div>
          <div className="mt-3 max-h-56 overflow-y-auto">
            {customers.length === 0 && (
              <p className="text-muted-foreground text-sm">No customers yet.</p>
            )}
            {customers.map((c) => (
              <div key={c.id} className="border-border border-b py-1.5 text-sm last:border-0">
                <span className="font-medium">{c.company}</span>
                {c.contact_person && (
                  <span className="text-muted-foreground"> · {c.contact_person}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">Create document</p>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <select className={inputClass} value={doc.doc_type} onChange={(e) => setDoc((d) => ({ ...d, doc_type: e.target.value }))}>
                <option value="QT">Quotation</option>
                <option value="DO">Delivery Order</option>
                {canInvoice && <option value="INV">Invoice</option>}
              </select>
              <select className={inputClass} value={doc.customer_id} onChange={(e) => setDoc((d) => ({ ...d, customer_id: Number(e.target.value) }))}>
                <option value={0}>Customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </select>
            </div>
            {doc.items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_110px] gap-2">
                <input className={inputClass} placeholder="Item" value={item.name}
                  onChange={(e) => setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) }))} />
                <input type="number" min={1} className={inputClass} value={item.qty}
                  onChange={(e) => setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i ? { ...x, qty: Number(e.target.value) } : x) }))} />
                <input type="number" min={0} className={inputClass} placeholder="Price (sen)" value={item.unit_price_cents}
                  onChange={(e) => setDoc((d) => ({ ...d, items: d.items.map((x, xi) => xi === i ? { ...x, unit_price_cents: Number(e.target.value) } : x) }))} />
              </div>
            ))}
            <button type="button" className="text-xs underline" onClick={() => setDoc((d) => ({ ...d, items: [...d.items, { name: "", qty: 1, unit_price_cents: 0 }] }))}>
              + Add line
            </button>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" min={0} className={inputClass} placeholder="Discount (sen)" value={doc.discount_cents}
                onChange={(e) => setDoc((d) => ({ ...d, discount_cents: Number(e.target.value) }))} />
              <input type="number" min={0} step={0.5} className={inputClass} placeholder="Tax %" value={doc.tax_percent}
                onChange={(e) => setDoc((d) => ({ ...d, tax_percent: Number(e.target.value) }))} />
            </div>
            <p className="text-sm font-medium">Total: {fmtRM(total)}</p>
            <button type="button" className={btnClass} onClick={() => void createDoc()}>Create with auto number</button>
          </div>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Documents</p>
        {docs.length === 0 && <p className="text-muted-foreground mt-2 text-sm">No documents yet.</p>}
        <div className="max-h-96 overflow-y-auto">
        {docs.map((d) => (
          <div key={d.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
            <span>
              <span className="font-medium">{d.doc_number}</span> · {d.company} · {fmtRM(d.total_cents)}
              <span className="text-muted-foreground"> · {dmy(d.created_at)}</span>
            </span>
            {d.doc_type === "INV" && canInvoice && (
              <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs" value={d.payment_status ?? "unpaid"} onChange={(e) => void setStatus(d, e.target.value)}>
                {["unpaid", "paid", "overdue"].map((sx) => <option key={sx} value={sx}>{sx}</option>)}
              </select>
            )}
            {d.doc_type === "DO" && (
              <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs" value={d.delivery_status ?? "pending"} onChange={(e) => void setStatus(d, e.target.value)}>
                {["pending", "delivered"].map((sx) => <option key={sx} value={sx}>{sx}</option>)}
              </select>
            )}
            {d.doc_type === "QT" && <span className="text-muted-foreground text-xs">Quotation</span>}
            <button type="button" className="border-border ml-1 rounded-lg border px-2 py-1 text-xs hover:bg-secondary"
              onClick={() => void printDoc(d.id)}>PDF</button>
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
  useEffect(() => {
    void api<{ profile: Record<string, string | null> }>(`/staff/profile`).then((r) => {
      if (r.data?.profile) {
        setProfile(r.data.profile);
        setPhone(r.data.profile.phone ?? "");
      }
    });
  }, []);
  const save = async () => {
    setSaving(true);
    const res = await api(`/staff/profile`, { method: "PATCH", body: JSON.stringify({ phone }) });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
        <label className="mt-4 block">
          <span className="text-muted-foreground mb-1 block text-xs">Phone (you can update this)</span>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
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

const ALL_TABS = ["Dashboard", "Attendance", "Leave", "Tasks", "Announcements", "Sales", "HR", "Staff Details", "Payroll", "Claims", "Inventory", "Birthdays", "Overview", "Profile"] as const;

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
  Claims: ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"],
  // Inventory & tracking: sales_marketing only among staff (editor/marketing
  // and everyone else are excluded).
  Inventory: ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  // Read-only company monitor. CEO + COO + CCO + admin tier.
  Overview: ["ceo", "coo", "cco", "super_admin", "admin"],
  // CEO can manage birthdays (their one write exception); HR tier too.
  Birthdays: ["ceo", "hr_admin", "coo", "cco", "super_admin", "admin"],
  // Employee records: IDs, position, department, staff list, birth dates.
  "Staff Details": ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],
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

  useEffect(() => {
    if (!user) return;
    const fetchNotifs = () =>
      void api<{ notifications: Notification[] }>("/staff/notifications").then((r) =>
        setNotifs(r.data?.notifications ?? []),
      );
    fetchNotifs();
    // Live alerting (v1.4.31): announcements and assignments reach the bell
    // without a reload — poll every 60s and whenever the tab regains focus.
    const timer = window.setInterval(fetchNotifs, 60_000);
    window.addEventListener("focus", fetchNotifs);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", fetchNotifs);
    };
  }, [user, tab]);

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
    <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-24 md:px-5 md:py-6 md:pb-6">
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-5 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <div>
          <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">Staff Portal</p>
          <h1 className="hidden text-xl font-semibold tracking-tight md:block">
            Welcome, {user.name.split(" ")[0]}
          </h1>
          {/* On phones the header reads like an app screen title. */}
          <h1 className="text-lg font-semibold tracking-tight md:hidden">{tab}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${btnGhost} relative`}
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
          <button type="button" className={btnGhost} onClick={() => setDark((v) => !v)} aria-label="Toggle dark mode">
            {dark ? "☀️" : "🌙"}
          </button>
          <button
            type="button"
            className={btnGhost}
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

      <nav className="mt-6 hidden gap-2 md:flex md:flex-wrap" aria-label="Portal sections">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "bg-primary text-primary-foreground shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium"
                : "shrink-0 rounded-lg border border-border px-4 py-1.5 text-sm hover:bg-secondary"
            }
          >
            {t}
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
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main key={tab} className="screen-enter mt-4 md:mt-6">
        {tab === "Dashboard" && <Dashboard user={user} go={setTab} />}
        {tab === "Claims" && <ClaimsPanel />}
        {tab === "Attendance" && (
          <>
            <Attendance user={user} />
            {["ceo", "super_admin", "admin"].includes(user.role) && <AttendanceAdminPanel />}
          </>
        )}
        {tab === "Leave" && <Leave user={user} />}
        {tab === "Tasks" && <Tasks user={user} />}
        {tab === "Announcements" && <Announcements user={user} />}
        {tab === "Sales" && SALES_ROLES.includes(user.role) && <Sales user={user} />}
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
