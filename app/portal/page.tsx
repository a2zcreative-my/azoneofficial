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
import {
  AttendanceAdminPanel,
  BirthdaysPanel,
  HrPanel,
  InventoryPanel,
  OverviewPanel,
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
const card = "rounded-lg border border-border bg-card p-4";

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
  return new Date(iso.replace(" ", "T") + "Z").toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
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
const SALES_ROLES = ["super_admin", "admin", "hr_admin", "coo", "cco"];

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
function PunchToast({ title, sub }: { title: string; sub: string }) {
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
          <circle cx="26" cy="26" r="24" fill="none" stroke="#1a2946" strokeWidth="2.5"
            strokeDasharray="151" style={{ animation: "punch-ring .6s ease-out .1s both" }} />
          <path d="M15 27l7.5 7.5L37 20" fill="none" stroke="#1a2946" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray="36"
            style={{ animation: "punch-check .35s ease-out .55s both" }} />
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
    const month = new Date().toISOString().slice(0, 7);
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

  const [punchToast, setPunchToast] = useState<{ title: string; sub: string } | null>(null);
  const [punchError, setPunchError] = useState("");
  const punch = async (type: string) => {
    setBusy(type);
    setPunchError("");
    const res = await api<{ flag?: string; error?: { message?: string } }>(`/staff/attendance`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    setBusy("");
    if (res.ok && res.data?.flag) {
      const label: Record<string, string> = {
        ok: "On time", late: "Marked late", half_day: "Half day",
        early_out: "Early out", completed: "Shift completed",
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
    <div className="space-y-6">
      <div className={card}>
        <p className="text-sm font-semibold">Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnClass} disabled={!!busy || hasIn} onClick={() => void punch("clock_in")}>
            Clock in
          </button>
          <button type="button" className={btnGhost} disabled={!!busy || hasOut || !hasIn} onClick={() => void punch("clock_out")}>
            Clock out
          </button>
          <button type="button" className={btnGhost} onClick={() => go("Leave")}>Apply leave</button>
          {SALES_ROLES.includes(user.role) && (
            <button type="button" className={btnGhost} onClick={() => go("Sales")}>Create quotation</button>
          )}
        </div>
        {punchError && <p className="text-destructive mt-2 text-xs font-medium">{punchError}</p>}
        {punchToast && <PunchToast title={punchToast.title} sub={punchToast.sub} />}
        <p className="text-muted-foreground mt-3 text-xs">
          {today.length === 0
            ? "No attendance recorded today."
            : `Today: ${today.slice().reverse().map((r) => `${r.type.replace("_", " ")} ${mytTime(r.created_at)}`).join(" · ")}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={card}>
          <p className="text-sm font-semibold">
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
                {l.type} · {l.start_date} → {l.end_date} ({l.days}d)
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p className="text-sm font-semibold">
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
          <p className="text-sm font-semibold">
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
    </div>
  );
}

/* ================= Attendance ================= */

function Attendance({ user }: { user: User }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState<{ type: string; created_at: string; name?: string }[]>([]);
  const [reportMode, setReportMode] = useState(false);
  const canReport = MANAGE_ROLES.includes(user.role);

  useEffect(() => {
    const path = reportMode && canReport ? `/staff/attendance/report?month=${month}` : `/staff/attendance?month=${month}`;
    void api<{ records: typeof records }>(path).then((r) => setRecords(r.data?.records ?? []));
  }, [month, reportMode, canReport]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" className={`${inputClass} w-auto`} value={month} onChange={(e) => setMonth(e.target.value)} />
        {canReport && (
          <button type="button" className={btnGhost} onClick={() => setReportMode((v) => !v)}>
            {reportMode ? "My attendance" : "Team report"}
          </button>
        )}
      </div>
      <div className={card}>
        {records.length === 0 && <p className="text-muted-foreground text-sm">No records for this month.</p>}
        {records.map((r, i) => (
          <p key={i} className="border-border border-b py-1.5 text-sm last:border-0">
            {r.name ? <span className="font-medium">{r.name} · </span> : null}
            {r.type.replace("_", " ")} — {mytDateTime(r.created_at)} MYT
          </p>
        ))}
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
    <div className="space-y-6">
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

      <div className="grid gap-6 lg:grid-cols-2">
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
                {l.type} · {l.start_date} → {l.end_date} ({l.days}d) —{" "}
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
                <span className="font-medium">{l.user_name}</span> · {l.type} · {l.start_date} → {l.end_date} ({l.days}d)
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
    <div className="grid gap-6 lg:grid-cols-2">
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
    <div className="space-y-6">
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
        <article key={a.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{a.title} <span className="text-muted-foreground font-normal">· {a.category} · {a.created_at.slice(0, 10)}</span></p>
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
      <div style="color:#5b6472">${(doc.created_at || "").slice(0, 10)}</div></div>
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
  const canInvoice = ["super_admin", "admin", "hr_admin", "coo", "cco"].includes(user.role);

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
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
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
              <span className="text-muted-foreground"> · {d.created_at.slice(0, 10)}</span>
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
    <div className="grid gap-6 lg:grid-cols-2">
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

const ALL_TABS = ["Dashboard", "Attendance", "Leave", "Tasks", "Announcements", "Sales", "HR", "Staff Details", "Inventory", "Birthdays", "Overview", "Profile"] as const;

/** Which roles see each role-specific tab. The API enforces the same matrix. */
// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];

const TAB_ROLES: Partial<Record<(typeof ALL_TABS)[number], readonly string[]>> = {
  // HR pipeline: docs (QT/DO/INV), leave, attendance + payroll CSV.
  HR: ["hr_admin", "coo", "cco", "super_admin", "admin"],
  // Inventory & tracking: sales_marketing only among staff (editor/marketing
  // and everyone else are excluded).
  Inventory: ["sales_marketing", "super_admin", "admin"],
  // Read-only company monitor. CEO + COO + CCO + admin tier.
  Overview: ["ceo", "coo", "cco", "super_admin", "admin"],
  // CEO can manage birthdays (their one write exception); HR tier too.
  Birthdays: ["ceo", "hr_admin", "coo", "cco", "super_admin", "admin"],
  // Employee records: IDs, position, department, staff list, birth dates.
  "Staff Details": ["hr_admin", "coo", "cco", "super_admin", "admin"],
};
type TabName = (typeof ALL_TABS)[number];

export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<TabName>("Dashboard");
  const [dark, setDark] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);

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
    void api<{ notifications: Notification[] }>("/staff/notifications").then((r) =>
      setNotifs(r.data?.notifications ?? []),
    );
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
    if (t === "Sales") return SALES_ROLES.includes(user.role);
    const allowed = TAB_ROLES[t];
    return !allowed || allowed.includes(user.role);
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-gold-deep text-xs font-medium tracking-[0.3em] uppercase">Staff Portal</p>
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome, {user.name.split(" ")[0]}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnGhost}
            aria-label="Notifications"
            onClick={() => {
              setShowNotifs((v) => !v);
              if (unread) void api("/staff/notifications/read", { method: "POST", body: JSON.stringify({}) });
            }}
          >
            🔔 {unread > 0 ? unread : ""}
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
          {notifs.length === 0 && <p className="text-muted-foreground mt-2 text-sm">Nothing yet.</p>}
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
              <span className="text-muted-foreground text-xs">· {n.created_at.slice(0, 16)}</span>
            </p>
          ))}
        </div>
      )}

      <nav className="mt-6 -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:overflow-visible" aria-label="Portal sections">
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

      <main className="mt-6">
        {tab === "Dashboard" && <Dashboard user={user} go={setTab} />}
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
        {tab === "HR" && <HrPanel />}
        {tab === "Staff Details" && <StaffDirectory canAmend={["super_admin", "admin"].includes(user.role)} />}
        {tab === "Inventory" && <InventoryPanel />}
        {tab === "Birthdays" && <BirthdaysPanel />}
        {tab === "Overview" && <OverviewPanel />}
        {tab === "Profile" && <Profile />}
      </main>
    </div>
  );
}
