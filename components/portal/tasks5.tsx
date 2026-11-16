"use client";

/* v1.313.0 - TASKS WORKSPACE 5.0, Gate 3 (the CEO, 15-11-2026, "Approved as
   per recommendations both" on claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md).
   The pieces the five board images add around the one task engine: the
   task preview beside My Tasks, the four cards under it, the workload,
   department and quick-approval cards beside All Tasks, the work calendar
   and the Live Host card. Screens only: every figure is read from rows
   that already exist (tasks, task items, task blocks, live sessions,
   projects); nothing here writes, and nothing is invented - a figure with
   no source is not drawn (TK-6, TK-10). */

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { L, type Task, priorityL } from "@/components/portal/page-shared";
import { stamp } from "@/components/portal/task-progress";
import { PillSwitch } from "@/components/ui/panel"; // v1.323.0 - the one view switch
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { api, csrfFetch } from "@/lib/api";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useCachedApi } from "@/lib/cached-api";
import { dmy } from "@/lib/format";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import t5 from "./tasks5.module.css";

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** The board's priority words (TK-3): normal reads Medium. */
export const prioWord = (p: string) => (p === "normal" ? L("Medium", "Sederhana") : priorityL(p).replace(/^./, (c) => c.toUpperCase()));
export const PRIO_CHIP: Record<string, string> = { urgent: chipSmDanger, high: chipSmDanger, normal: chipSmWarn, low: chipSmInfo };
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
/** Monday of the week a day falls in (the roster's week). */
export const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };

type Block = { id: number; task_id: number; user_id: number; block_date: string; start_time: string; end_time: string | null; title: string; status: string; done_at: string | null };
type Session = { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; status: string; host_name?: string; host_user_id?: number; client_company?: string | null; client_name?: string | null };
type Roster = { task_blocks?: Block[]; sessions?: Session[]; days?: string[] };

/** The weeks (Mondays) that a range of days touches - the roster is read a week at a time. */
function mondaysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}
function useRosterWeeks(mondays: string[]): { blocks: Block[]; sessions: Session[]; loading: boolean } {
  const key = mondays.join(",");
  const [state, setState] = useState<{ key: string; blocks: Block[]; sessions: Session[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all(key.split(",").filter(Boolean).map((w) => api<Roster>(`/staff/roster?week=${w}`))).then((rs) => {
      if (!alive) return;
      setState({ key, blocks: rs.flatMap((r) => r.data?.task_blocks ?? []), sessions: rs.flatMap((r) => r.data?.sessions ?? []) });
    });
    return () => { alive = false; };
  }, [key]);
  return state?.key === key ? { blocks: state.blocks, sessions: state.sessions, loading: false } : { blocks: [], sessions: [], loading: true };
}

export function Head5({ icon, title, sub, aside }: { icon: AppIconName; title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className={t5.head}>
      <span className={t5.headIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={t5.headText}><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {aside && <span className={t5.headAside}>{aside}</span>}
    </div>
  );
}

export function Bar5({ pct, done }: { pct: number; done?: boolean }) {
  return <span className={t5.track} aria-hidden><span className={`${t5.fill} ${done ? t5.fillDone : ""}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>;
}

/** Priority work: overdue, then due today, then urgent/high, then the soonest due (Overview, My Focus). */
export function byUrgency(rows: Task[], today: string): Task[] {
  const score = (t: Task) => (t.deadline && t.deadline < today ? 0 : t.deadline === today ? 1 : (PRIORITY_RANK[t.priority] ?? 2) <= 1 ? 2 : 3);
  return [...rows].sort((a, b) => score(a) - score(b) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2));
}

/* ---------------- My Tasks: the four cards under the list (image 1) ---------------- */
export function MyDayCards({ mine, today, userId, onOpen, onArchive }: { mine: Task[]; today: string; userId: number; onOpen: (id: number) => void; onArchive: () => void }) {
  const roster = useCachedApi<Roster>(`/staff/roster?week=${mondayOf(today)}`, true, ["tasks", "roster"]);
  const open = mine.filter((t) => t.status !== "completed");
  const focus = byUrgency(open, today).slice(0, 3);
  const agenda = (roster.data?.task_blocks ?? []).filter((b) => b.block_date === today && b.user_id === userId).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const lives = (roster.data?.sessions ?? []).filter((s) => s.session_date === today && s.host_user_id === userId && s.status !== "cancelled");
  const week = addDays(today, 7);
  const upcoming = open.filter((t) => t.deadline && t.deadline <= week).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).slice(0, 3);
  const recent = mine.filter((t) => t.latest_update).sort((a, b) => b.latest_update!.at.localeCompare(a.latest_update!.at)).slice(0, 3);
  const pill = (d: string) => `${t5.datePill} ${d < today ? t5.dateLate : d <= addDays(today, 2) ? t5.dateSoon : ""}`;
  return (
    <div className={t5.four} data-testid="my-day-cards">
      <section className={card} aria-label={L("My Focus", "Fokus Saya")} data-testid="my-focus">
        <Head5 icon="target" title={L("My Focus", "Fokus Saya")} sub={L("Key priorities to move forward today.", "Keutamaan untuk digerakkan hari ini.")} />
        {focus.length === 0 ? <p className={t5.empty}>{L("Nothing open - you are caught up.", "Tiada yang terbuka - semua selesai.")}</p> : (
          <ul className={t5.list}>{focus.map((t, i) => (
            <li key={t.id}><button type="button" onClick={() => onOpen(t.id)}>
              <span className={`${t5.rank} ${i === 0 ? t5.rankFirst : ""}`}>{i + 1}</span>
              <span className={t5.itemText}><strong>{t.title}</strong><small>{prioWord(t.priority)} · {t.deadline ? (t.deadline < today ? L(`Overdue since ${dmy(t.deadline)}`, `Lewat sejak ${dmy(t.deadline)}`) : t.deadline === today ? L("Due today", "Perlu siap hari ini") : L(`Due ${dmy(t.deadline)}`, `Siap ${dmy(t.deadline)}`)) : L("No due date", "Tiada tarikh akhir")}</small></span>
            </button></li>
          ))}</ul>
        )}
      </section>
      <section className={card} aria-label={L("Today's Agenda", "Agenda Hari Ini")} data-testid="my-agenda">
        <Head5 icon="date" title={L("Today's Agenda", "Agenda Hari Ini")} sub={L("Your scheduled task blocks and lives for today.", "Blok tugasan dan live anda yang dijadualkan hari ini.")} />
        {roster.loading && !roster.data ? <SkelRows rows={3} /> : agenda.length + lives.length === 0 ? <p className={t5.empty}>{L("Nothing booked on the roster today.", "Tiada apa dijadualkan dalam roster hari ini.")}</p> : (
          <ul className={t5.list}>
            {[...agenda.map((b) => ({ k: `b${b.id}`, at: b.start_time, title: b.title, sub: b.done_at ? L("Done", "Selesai") : L("Task block", "Blok tugasan"), open: () => onOpen(b.task_id) })),
              ...lives.map((s) => ({ k: `s${s.id}`, at: s.start_time, title: L(`Live - ${s.platform}`, `Live - ${s.platform}`), sub: s.client_company ?? s.client_name ?? L("Live session", "Sesi live"), open: null as null | (() => void) }))]
              .sort((a, b) => a.at.localeCompare(b.at)).map((x) => (
                <li key={x.k}>{x.open ? (
                  <button type="button" onClick={x.open}><span className={t5.dot} /><span className={t5.time}>{x.at.slice(0, 5)}</span><span className={t5.itemText}><strong>{x.title}</strong><small>{x.sub}</small></span></button>
                ) : (
                  <span className={t5.row}><span className={`${t5.dot} ${t5.dotGold}`} /><span className={t5.time}>{x.at.slice(0, 5)}</span><span className={t5.itemText}><strong>{x.title}</strong><small>{x.sub}</small></span></span>
                )}</li>
              ))}
          </ul>
        )}
      </section>
      <section className={card} aria-label={L("Upcoming Deadlines", "Tarikh Akhir Akan Datang")} data-testid="my-deadlines">
        <Head5 icon="time" title={L("Upcoming Deadlines", "Tarikh Akhir Akan Datang")} sub={L("Tasks due soon (next 7 days).", "Tugasan perlu siap tidak lama lagi (7 hari).")} />
        {upcoming.length === 0 ? <p className={t5.empty}>{L("Nothing due in the next 7 days.", "Tiada yang perlu siap dalam 7 hari.")}</p> : (
          <ul className={t5.list}>{upcoming.map((t) => (
            <li key={t.id}><button type="button" onClick={() => onOpen(t.id)}>
              <span className={pill(t.deadline!)}><AppIcon name="date" />{shortDay(t.deadline!)}</span>
              <span className={t5.itemText}><strong>{t.title}</strong><small>{[t.stage === "review" ? L("Review", "Semakan") : t.status === "in_progress" ? L("In Progress", "Sedang Berjalan") : L("Open", "Terbuka"), `${t.progress}%`].join(" · ")}</small></span>
            </button></li>
          ))}</ul>
        )}
      </section>
      <section className={card} aria-label={L("Recent Updates", "Kemas Kini Terkini")} data-testid="my-recent">
        <Head5 icon="refresh" title={L("Recent Updates", "Kemas Kini Terkini")} sub={L("Latest progress on your tasks.", "Kemajuan terkini tugasan anda.")} aside={<button type="button" className={btnSm} onClick={onArchive}>{L("View History", "Lihat Sejarah")}</button>} />
        {recent.length === 0 ? <p className={t5.empty}>{L("No progress reported yet.", "Belum ada kemajuan dilaporkan.")}</p> : (
          <ul className={t5.list}>{recent.map((t) => (
            <li key={t.id}><button type="button" onClick={() => onOpen(t.id)}>
              <span className={t5.itemText}><strong>{t.title}</strong><small>{t.latest_update!.body}</small><small>{t.latest_update!.by ?? ""} · {stamp(t.latest_update!.at)}</small></span>
            </button></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- All Tasks: the side column (image 3) ---------------- */
export function WorkloadCard({ tasks, onPick }: { tasks: Task[]; onPick: (id: number) => void }) {
  const rows = useMemo(() => {
    const m = new Map<number, { id: number; name: string; photo?: string | null; n: number }>();
    for (const t of tasks) if (t.status !== "completed" && t.assigned_to) {
      const x = m.get(t.assigned_to) ?? { id: t.assigned_to, name: t.assignee ?? "—", photo: t.assignee_photo, n: 0 };
      x.n += 1; m.set(t.assigned_to, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [tasks]);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className={card} aria-label={L("Workload Balance", "Imbangan Beban Kerja")} data-testid="workload-card">
      <Head5 icon="users" title={L("Workload Balance", "Imbangan Beban Kerja")} sub={L("Active tasks by assignee (top 5).", "Tugasan aktif mengikut penerima (5 teratas).")} />
      {rows.length === 0 ? <p className={t5.empty}>{L("No active tasks.", "Tiada tugasan aktif.")}</p> : (
        <ul className={t5.list}>{rows.map((r) => (
          <li key={r.id}><button type="button" onClick={() => onPick(r.id)} aria-label={L(`${r.name}: ${r.n} active - show their tasks`, `${r.name}: ${r.n} aktif - tunjuk tugasan`)}>
            <Avatar name={r.name} photoKey={r.photo} size="sm" />
            <span className={t5.load}><span>{r.name}</span><span className={t5.num}>{r.n}</span><Bar5 pct={(r.n / max) * 100} /></span>
          </button></li>
        ))}</ul>
      )}
    </section>
  );
}

const DEPT_COLORS = ["var(--gold-solid)", "var(--info)", "var(--success)", "var(--danger)", "var(--muted-foreground)"];
export function DepartmentCard({ tasks, deptOf }: { tasks: Task[]; deptOf: (userId?: number) => string }) {
  const open = tasks.filter((t) => t.status !== "completed");
  const counts = new Map<string, number>();
  for (const t of open) { const d = deptOf(t.assigned_to) || L("Others", "Lain-lain"); counts.set(d, (counts.get(d) ?? 0) + 1); }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((s, [, n]) => s + n, 0);
  const slices = [...top, ...(rest ? [[L("Others", "Lain-lain"), rest] as [string, number]] : [])].map(([label, value], i) => ({ label: `${label} (${Math.round((value / Math.max(1, open.length)) * 100)}%)`, value, color: DEPT_COLORS[i % DEPT_COLORS.length]! }));
  return (
    <section className={card} aria-label={L("Department Breakdown", "Pecahan Jabatan")} data-testid="department-card">
      <Head5 icon="chart" title={L("Department Breakdown", "Pecahan Jabatan")} sub={L("Active tasks by the assignee's department.", "Tugasan aktif mengikut jabatan penerima.")} />
      {open.length === 0 ? <p className={t5.empty}>{L("No active tasks.", "Tiada tugasan aktif.")}</p> : <div className={t5.deptRow}><Donut slices={slices} centerLabel={String(open.length)} centerSub={L("Tasks", "Tugasan")} /></div>}
    </section>
  );
}

export function QuickApprovals({ tasks, onOpen, onAll }: { tasks: Task[]; onOpen: (id: number) => void; onAll: () => void }) {
  const rows = tasks.filter((t) => t.status !== "completed" && t.stage === "review").sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  return (
    <section className={card} aria-label={L("Quick Approvals", "Kelulusan Pantas")} data-testid="quick-approvals">
      <Head5 icon="verify" title={L("Quick Approvals", "Kelulusan Pantas")} sub={L("Tasks waiting for your review.", "Tugasan menunggu semakan anda.")} aside={<span className={chipSmWarn}>{rows.length}</span>} />
      {rows.length === 0 ? <p className={t5.empty}>{L("Nothing waiting for review.", "Tiada yang menunggu semakan.")}</p> : (
        <ul className={t5.list}>{rows.slice(0, 3).map((t) => (
          <li key={t.id}><button type="button" onClick={() => onOpen(t.id)}>
            <AppIcon name="document" />
            <span className={t5.itemText}><strong>{t.title}</strong><small>{[t.link_label, t.deadline ? L(`Due ${shortDay(t.deadline)}`, `Siap ${shortDay(t.deadline)}`) : null].filter(Boolean).join(" · ")}</small></span>
            <span className={chipSmWarn}>{L("Review", "Semak")}</span>
          </button></li>
        ))}</ul>
      )}
      {rows.length > 3 && <button type="button" className={btnSm} onClick={onAll}>{L("View All Approvals", "Lihat Semua Kelulusan")} <AppIcon name="next" /></button>}
    </section>
  );
}

/* ---------------- Calendar (image 2): one calendar over the work records ---------------- */
type CalProject = { id: number; title: string; company: string | null; due_date: string | null; status: string };
/* v1.328.0 - R-2: the lives left with the roster (People > Roster & Scheduling);
   task blocks stay as "Booked work" - time booked FOR a task - off by default */
type EvKind = "task" | "due" | "review" | "mile";
type Ev = { key: string; kind: EvKind; day: string; title: string; sub: string; at?: string; late?: boolean; open: null | (() => void); who?: number };
const KIND_WORD: Record<EvKind, [string, string]> = { task: ["Booked work", "Kerja dijadualkan"], due: ["Deadlines", "Tarikh akhir"], review: ["Reviews", "Semakan"], mile: ["Milestones", "Pencapaian"] };
const KIND_SUB: Record<EvKind, [string, string]> = { task: ["Booked work blocks", "Blok kerja dijadualkan"], due: ["Due date", "Tarikh akhir"], review: ["Waiting for review", "Menunggu semakan"], mile: ["Project due dates", "Tarikh akhir projek"] };
const EV_CLS: Record<EvKind, string> = { task: t5.evTask ?? "", due: t5.evDue ?? "", review: t5.evReview ?? "", mile: t5.evMile ?? "" };
const SW_CLS: Record<EvKind, string> = { task: t5.swTask ?? "", due: t5.swDue ?? "", review: t5.swReview ?? "", mile: t5.swMile ?? "" };
const CAL_ON: Record<EvKind, boolean> = { task: false, due: true, review: true, mile: true };
const EV_ICON: Record<EvKind, AppIconName> = { task: "orders", due: "warning", review: "search", mile: "folder" };

export function WorkCalendar({ tasks, projects, today, month, setMonth, staff, onOpenTask, onOpenProject }: {
  tasks: Task[]; projects: CalProject[] | null; today: string; month: string; setMonth: (m: string) => void;
  staff: { id: number; name: string }[] | null; onOpenTask: (id: number) => void; onOpenProject: (id: number) => void;
}) {
  const [mode, setMode] = useState<"month" | "week" | "list">("month");
  const [picked, setPicked] = useState(today);
  const [who, setWho] = useState(0);
  const [proj, setProj] = useState("");
  const [on, setOn] = useState<Record<EvKind, boolean>>(CAL_ON);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(days).padStart(2, "0")}`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay(); // Sunday first, as the board
  const weekStart = addDays(picked, -new Date(`${picked}T00:00:00Z`).getUTCDay());
  const span = mode === "week" ? [weekStart, addDays(weekStart, 6)] : [first, last];
  const roster = useRosterWeeks(mondaysIn(span[0]!, span[1]!));
  const projects_ = useMemo(() => [...new Set(tasks.map((t) => t.link_label).filter((x): x is string => !!x))].sort(), [tasks]);

  const events = useMemo(() => {
    const keepTask = (t: Task) => (!who || t.assigned_to === who) && (!proj || t.link_label === proj);
    const out: Ev[] = [];
    for (const t of tasks) {
      if (!keepTask(t) || t.stage === "cancelled") continue;
      if (t.deadline) out.push({ key: `d${t.id}`, kind: "due", day: t.deadline.slice(0, 10), title: t.title, sub: t.assignee ?? "", late: t.status !== "completed" && t.deadline < today, open: () => onOpenTask(t.id), who: t.assigned_to });
      if (t.status !== "completed" && t.stage === "review") out.push({ key: `r${t.id}`, kind: "review", day: (t.latest_update?.at ?? t.deadline ?? today).slice(0, 10), title: t.title, sub: t.assignee ?? "", open: () => onOpenTask(t.id), who: t.assigned_to });
    }
    for (const b of roster.blocks) {
      const t = tasks.find((x) => x.id === b.task_id);
      if ((who && b.user_id !== who) || (proj && t?.link_label !== proj)) continue;
      out.push({ key: `b${b.id}`, kind: "task", day: b.block_date, at: b.start_time, title: b.title, sub: `${b.start_time.slice(0, 5)}${b.end_time ? ` – ${b.end_time.slice(0, 5)}` : ""}`, open: () => onOpenTask(b.task_id), who: b.user_id });
    }
    if (!who) for (const p of projects ?? []) {
      if (!p.due_date || p.status === "cancelled" || (proj && !proj.startsWith(p.title))) continue;
      out.push({ key: `p${p.id}`, kind: "mile", day: p.due_date.slice(0, 10), title: p.title, sub: p.company ?? L("Project due", "Projek perlu siap"), late: p.status !== "completed" && p.due_date < today, open: () => onOpenProject(p.id) });
    }
    return out.filter((e) => on[e.kind]).sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? "99").localeCompare(b.at ?? "99"));
  }, [tasks, roster.blocks, projects, who, proj, on, today, onOpenTask, onOpenProject]);

  const byDay = useMemo(() => { const mp = new Map<string, Ev[]>(); for (const e of events) mp.set(e.day, [...(mp.get(e.day) ?? []), e]); return mp; }, [events]);
  const dayEvents = byDay.get(picked) ?? [];
  const overdue = tasks.filter((t) => t.status !== "completed" && t.stage !== "cancelled" && t.deadline && t.deadline < today && (!who || t.assigned_to === who)).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const upcoming = tasks.filter((t) => t.status !== "completed" && t.deadline && t.deadline >= today && (!who || t.assigned_to === who)).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).slice(0, 3);
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); setMonth(d); };
  const shiftWeek = (k: number) => { const d = addDays(picked, 7 * k); setPicked(d); if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7)); };
  const monthWord = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
  const lateDays = (d: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  const pillFor = (e: Ev) => (
    <button key={e.key} type="button" className={`${t5.ev} ${EV_CLS[e.kind]}`} title={`${e.title}${e.sub ? ` · ${e.sub}` : ""}`}
      onClick={(ev) => { ev.stopPropagation(); if (e.open) e.open(); else setPicked(e.day); }} data-kind={e.kind} data-testid={e.kind === "mile" ? `cal-project-${e.key.slice(1)}` : undefined}>
      <AppIcon name={EV_ICON[e.kind]} />{e.title}
    </button>
  );
  const cell = (iso: string, n: number) => {
    const list = byDay.get(iso) ?? [];
    return (
      <div key={iso} role="gridcell" tabIndex={0} className={`${t5.cell} ${iso === picked ? t5.cellOn : ""}`} aria-label={`${dmy(iso)}, ${list.length} ${L("events", "acara")}`}
        onClick={() => setPicked(iso)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setPicked(iso); } }} data-testid={`cal-day-${iso}`}>
        <span className={t5.dayNum}>{iso === today ? <span className={t5.today}>{n}</span> : n}</span>
        {list.slice(0, 2).map(pillFor)}
        {list.length > 2 && <span className={t5.more}>{L(`+${list.length - 2} more`, `+${list.length - 2} lagi`)}</span>}
      </div>
    );
  };
  const DOW = [["Sun", "Ahd"], ["Mon", "Isn"], ["Tue", "Sel"], ["Wed", "Rab"], ["Thu", "Kha"], ["Fri", "Jum"], ["Sat", "Sab"]] as const;
  const agendaDays = [...byDay.keys()].filter((d) => d >= span[0]! && d <= span[1]!).sort();

  const todayCount = (byDay.get(today) ?? []).length;
  const sunday = addDays(today, 6 - new Date(`${today}T00:00:00Z`).getUTCDay());
  const dueWeek = tasks.filter((t) => t.status !== "completed" && t.stage !== "cancelled" && t.deadline && t.deadline >= today && t.deadline <= sunday && (!who || t.assigned_to === who)).length;
  const reviews = tasks.filter((t) => t.status !== "completed" && t.stage === "review" && (!who || t.assigned_to === who)).length;
  const miles = (projects ?? []).filter((p) => p.due_date?.startsWith(month) && p.status !== "cancelled").length;
  return (
    <div className={t5.stack} data-testid="work-calendar">
      <KpiRow label={L("Calendar figures", "Angka kalendar")}>
        <KpiTile icon="date" tone="blue" label={L("Events Today", "Acara Hari Ini")} value={todayCount} busy={roster.loading} sub={L("Due dates, reviews, milestones and booked work shown", "Tarikh akhir, semakan, pencapaian dan kerja dijadualkan yang dipaparkan")} />
        <KpiTile icon="time" tone="gold" label={L("Due This Week", "Perlu Siap Minggu Ini")} value={dueWeek} sub={L(`Tasks due by ${dmy(sunday)}`, `Tugasan perlu siap sebelum ${dmy(sunday)}`)} />
        <KpiTile icon="search" tone="red" label={L("Reviews", "Semakan")} value={reviews} sub={L("Tasks awaiting review", "Tugasan menunggu semakan")} />
        <KpiTile icon="folder" tone="green" label={L("Milestones This Month", "Pencapaian Bulan Ini")} value={projects ? miles : ""} busy={projects === null} sub={L("Project due dates in the month", "Tarikh akhir projek dalam bulan")} />
      </KpiRow>
      <section className={card} aria-label={L("Calendar filters", "Penapis kalendar")}>
        <div className={t5.filters} data-testid="cal-filters">
          <strong>{L("Filter:", "Tapis:")}</strong>
          {staff && staff.length > 0 && (
            <select className={selectClassSm} aria-label={L("Staff", "Kakitangan")} value={who} onChange={(e) => setWho(Number(e.target.value))} data-testid="cal-staff">
              <option value={0}>{L("All staff", "Semua kakitangan")}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {projects_.length > 0 && (
            <select className={selectClassSm} aria-label={L("Project", "Projek")} value={proj} onChange={(e) => setProj(e.target.value)} data-testid="cal-project">
              <option value="">{L("All projects", "Semua projek")}</option>
              {projects_.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {(Object.keys(KIND_WORD) as EvKind[]).map((k) => (
            <button key={k} type="button" className={t5.chipBtn} aria-pressed={on[k]} onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))} data-testid={`cal-type-${k}`}>
              <span className={`${t5.sw} ${SW_CLS[k]}`} aria-hidden />{L(KIND_WORD[k][0], KIND_WORD[k][1])}
            </button>
          ))}
          {(who || proj || (Object.keys(CAL_ON) as EvKind[]).some((k) => on[k] !== CAL_ON[k])) ? <button type="button" className={btnSm} onClick={() => { setWho(0); setProj(""); setOn(CAL_ON); }}><AppIcon name="refresh" />{L("Clear Filters", "Kosongkan Penapis")}</button> : null}
        </div>
      </section>
      <div className={t5.splitWide}>
        <section className={card} aria-label={L("Calendar", "Kalendar")}>
          <div className={t5.calTop}>
            <p className={t5.calTitle}>{mode === "week" ? L(`Week of ${dmy(weekStart)}`, `Minggu ${dmy(weekStart)}`) : monthWord}</p>
            <span className={t5.calNav}>
              <button type="button" className={btnSm} aria-label={mode === "week" ? L("Previous week", "Minggu sebelum") : L("Previous month", "Bulan sebelum")} onClick={() => (mode === "week" ? shiftWeek(-1) : shift(-1))}><AppIcon name="previous" /></button>
              <button type="button" className={btnSm} onClick={() => { setMonth(today.slice(0, 7)); setPicked(today); }}>{L("Today", "Hari ini")}</button>
              <button type="button" className={btnSm} aria-label={mode === "week" ? L("Next week", "Minggu seterusnya") : L("Next month", "Bulan seterusnya")} onClick={() => (mode === "week" ? shiftWeek(1) : shift(1))}><AppIcon name="next" /></button>
            </span>
            <span className={t5.deskOnly}>
              <PillSwitch testid="cal-mode" label={L("Calendar view", "Paparan kalendar")} value={mode} onChange={setMode}
                options={[["month", L("Month", "Bulan")], ["week", L("Week", "Minggu")], ["list", L("List", "Senarai")]] as const} />
            </span>
          </div>
          {/* desktop: the grid (month or week) or the list; a phone always reads the agenda (directive s8) */}
          <div className={t5.deskOnly}>
            {mode === "list" ? null : (
              <div className={t5.grid} role="grid" aria-label={mode === "week" ? L("Week", "Minggu") : monthWord} data-testid="cal-grid">
                {DOW.map(([en, ms]) => <span key={en} className={t5.dow} role="columnheader">{L(en, ms)}</span>)}
                {mode === "week"
                  ? Array.from({ length: 7 }, (_, i) => { const iso = addDays(weekStart, i); return cell(iso, Number(iso.slice(8))); })
                  : <>
                      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className={t5.cellBlank} aria-hidden />)}
                      {Array.from({ length: days }, (_, i) => cell(`${month}-${String(i + 1).padStart(2, "0")}`, i + 1))}
                      {Array.from({ length: (7 - ((lead + days) % 7)) % 7 }, (_, i) => <span key={`a${i}`} className={t5.cellBlank} aria-hidden />)}
                    </>}
              </div>
            )}
          </div>
          <div className={mode === "list" ? "" : t5.phoneOnly} data-testid="cal-agenda">
            {agendaDays.length === 0 ? <p className={t5.empty}>{L("Nothing in this period.", "Tiada dalam tempoh ini.")}</p> : agendaDays.map((d) => (
              <div key={d}>
                <p className={t5.agendaDay}>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}{d === today ? ` · ${L("Today", "Hari ini")}` : ""}</p>
                <ul className={t5.list}>{(byDay.get(d) ?? []).map((e) => (
                  <li key={e.key}>{e.open ? (
                    <button type="button" onClick={e.open}><span className={`${t5.sw} ${SW_CLS[e.kind]}`} aria-hidden /><span className={t5.itemText}><strong className={e.late ? t5.danger : ""}>{e.title}</strong><small>{L(KIND_WORD[e.kind][0], KIND_WORD[e.kind][1])}{e.sub ? ` · ${e.sub}` : ""}</small></span></button>
                  ) : (
                    <span className={t5.row}><span className={`${t5.sw} ${SW_CLS[e.kind]}`} aria-hidden /><span className={t5.itemText}><strong>{e.title}</strong><small>{e.sub}</small></span></span>
                  )}</li>
                ))}</ul>
              </div>
            ))}
          </div>
          <div className={t5.legend} aria-label={L("Legend", "Petunjuk")}>
            {(Object.keys(KIND_WORD) as EvKind[]).map((k) => <span key={k}><span className={`${t5.sw} ${SW_CLS[k]}`} aria-hidden /><strong>{L(KIND_WORD[k][0], KIND_WORD[k][1])}</strong><span className={t5.muted}>{L(KIND_SUB[k][0], KIND_SUB[k][1])}</span></span>)}
          </div>
        </section>
        <div className={t5.side}>
          <section className={card} aria-label={L("The chosen day", "Hari dipilih")} data-testid="cal-day-panel">
            <div className={t5.dayHead}>
              <strong>{new Date(`${picked}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</strong>
              {picked === today && <span className={chipSmWarn}>{L("Today", "Hari ini")}</span>}
            </div>
            <p className={t5.note}>{L(`${dayEvents.length} events · ${dayEvents.filter((e) => e.kind === "due").length} due · ${dayEvents.filter((e) => e.kind === "review").length} review`, `${dayEvents.length} acara · ${dayEvents.filter((e) => e.kind === "due").length} perlu siap · ${dayEvents.filter((e) => e.kind === "review").length} semakan`)}</p>
            <p className={t5.subHead}><AppIcon name="time" />{L("Schedule", "Jadual")}</p>
            {dayEvents.length === 0 ? <p className={t5.empty}>{L("Nothing on this day.", "Tiada apa pada hari ini.")}</p> : (
              <ul className={t5.list}>{dayEvents.map((e) => (
                <li key={e.key}>{e.open ? (
                  <button type="button" onClick={e.open}><span className={t5.time}>{e.at ? e.at.slice(0, 5) : "—"}</span><span className={`${t5.sw} ${SW_CLS[e.kind]}`} aria-hidden /><span className={t5.itemText}><strong>{e.title}</strong><small>{e.sub}</small></span></button>
                ) : (
                  <span className={t5.row}><span className={t5.time}>{e.at ? e.at.slice(0, 5) : "—"}</span><span className={`${t5.sw} ${SW_CLS[e.kind]}`} aria-hidden /><span className={t5.itemText}><strong>{e.title}</strong><small>{e.sub}</small></span></span>
                )}</li>
              ))}</ul>
            )}
            <p className={t5.subHead}><AppIcon name="warning" />{L(`Overdue Carry-Overs (${overdue.length})`, `Lewat Dibawa (${overdue.length})`)}</p>
            {overdue.length === 0 ? <p className={t5.empty}>{L("Nothing overdue.", "Tiada yang lewat.")}</p> : (
              <ul className={t5.list} data-testid="cal-overdue">{overdue.slice(0, 3).map((t) => (
                <li key={t.id}><button type="button" onClick={() => onOpenTask(t.id)}><span className={t5.itemText}><strong>{t.title}</strong><small>{t.assignee ?? ""}</small></span><span className={chipSmDanger}>{L(`Overdue · ${lateDays(t.deadline!)}d`, `Lewat · ${lateDays(t.deadline!)}h`)}</span></button></li>
              ))}</ul>
            )}
            <p className={t5.subHead}><AppIcon name="date" />{L(`Upcoming Deadlines (${upcoming.length})`, `Tarikh Akhir Akan Datang (${upcoming.length})`)}</p>
            {upcoming.length === 0 ? <p className={t5.empty}>{L("Nothing due ahead.", "Tiada yang perlu siap.")}</p> : (
              <ul className={t5.list}>{upcoming.map((t) => (
                <li key={t.id}><button type="button" onClick={() => onOpenTask(t.id)}><span className={t5.datePill}><AppIcon name="date" />{shortDay(t.deadline!)}</span><span className={t5.itemText}><strong>{t.title}</strong><small>{t.link_label ?? t.assignee ?? ""}</small></span></button></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Reports & Archive: the Live Host Report (Gate 4, TK-1, TK-14) ----------------
   The host reports a live on the roster (L2): the figures, the company, the
   GMV screenshots (camera or gallery on a phone), then Submit for Review.
   The CEO, COO or CCO reviews, accepts or returns it - never their own (L3).
   Every version, screenshot and review stays (0201). Reported GMV is the
   host's figure - never sales, cash, commission or payroll. */
type LrRow = { id: number; session_id: number; host_user_id: number; host_name: string | null; state: string; company: string | null; current_version: number; session_date: string; start_time: string; end_time: string | null; platform: string; client_name: string | null; gmv_cents: number | null; draft_gmv_cents: number | null; file_count: number; updated_at: string };
type LrList = { reports: LrRow[]; sessions_to_report: { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; client_name: string | null }[]; can_review: boolean; me: number };
type LrDetail = {
  report: { id: number; host_user_id: number; state: string; company: string | null; current_version: number; draft_gmv_cents: number | null; draft_duration_min: number | null; draft_highlights: string | null; draft_blockers: string | null; draft_next_actions: string | null };
  session: { session_date: string; start_time: string; end_time: string | null; platform: string; client_name: string | null } | null;
  host: string | null;
  versions: { version: number; gmv_cents: number; duration_min: number | null; highlights: string | null; blockers: string | null; next_actions: string | null; company: string | null; by_name: string | null; submitted_at: string }[];
  files: { id: number; version: number | null; file_name: string | null; created_at: string }[];
  reviews: { id: number; version: number; action: string; note: string | null; actor_role: string | null; by_name: string | null; created_at: string }[];
  can: { edit: boolean; review: boolean };
};
const LR_STATE: Record<string, [string, string, string]> = {
  draft: ["Draft", "Draf", chipSmNeutral], submitted: ["Submitted", "Dihantar", chipSmInfo], reviewed: ["Reviewed", "Disemak", chipSmWarn],
  accepted: ["Accepted", "Diterima", chipSmInfo], returned: ["Returned for correction", "Dikembalikan untuk pembetulan", chipSmDanger],
};
const rm = (c: number | null | undefined) => (c == null ? "—" : `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const sessionWord = (x: { session_date: string; start_time: string; end_time: string | null; platform: string }) => `${shortDay(x.session_date)} · ${x.platform} · ${x.start_time.slice(0, 5)}${x.end_time ? `–${x.end_time.slice(0, 5)}` : ""}`;

/** One GMV screenshot, read through the authorised route (the host and the reviewers only). */
function Shot({ rid, fid, name }: { rid: number; fid: number; name: string | null }) {
  const src = `/api/v1/staff/live-reports/${rid}/files/${fid}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" className={t5.shot}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private screenshot behind the staff session, not a static asset */}
      <img src={src} alt={name ?? L("GMV screenshot", "Tangkapan skrin GMV")} />
    </a>
  );
}

export function LiveHostCard({ today }: { today: string }) {
  void today;
  const [tick, setTick] = useState(0);
  const [list, setList] = useState<LrList | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [d, setD] = useState<LrDetail | null>(null);
  const [form, setForm] = useState({ gmv: "", duration_min: "", company: "", highlights: "", blockers: "", next_actions: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [history, setHistory] = useState(false);
  const { prompt, node: promptNode } = usePrompt();
  useEffect(() => {
    let alive = true;
    void api<LrList>("/staff/live-reports").then((r) => { if (alive) setList(r.ok && r.data ? r.data : { reports: [], sessions_to_report: [], can_review: false, me: 0 }); });
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api<LrDetail>(`/staff/live-reports/${open}`).then((r) => {
      if (!alive || !r.ok || !r.data) return;
      const x = r.data; setD(x);
      setForm({ gmv: x.report.draft_gmv_cents != null ? (x.report.draft_gmv_cents / 100).toFixed(2) : "", duration_min: x.report.draft_duration_min != null ? String(x.report.draft_duration_min) : "", company: x.report.company ?? "",
        highlights: x.report.draft_highlights ?? "", blockers: x.report.draft_blockers ?? "", next_actions: x.report.draft_next_actions ?? "" });
    });
    return () => { alive = false; };
  }, [open, tick]);
  const refresh = () => setTick((n) => n + 1);
  const fail = (r: { data?: unknown }, f: string) => setMsg({ tone: "bad", text: (r.data as { error?: { message?: string } } | undefined)?.error?.message ?? f });
  const start = async (sid: number) => {
    const r = await api<{ id?: number }>("/staff/live-reports", { method: "POST", body: JSON.stringify({ session_id: sid }) });
    if (r.ok && r.data?.id) { setOpen(r.data.id); setMsg(null); refresh(); } else fail(r, L("The report could not be started", "Laporan tidak dapat dimulakan"));
  };
  const saveDraft = async (quiet = false) => {
    if (!d) return false;
    const r = await api(`/staff/live-reports/${d.report.id}/draft`, { method: "PUT", body: JSON.stringify(form) });
    if (!r.ok) { fail(r, L("The draft was not saved", "Draf tidak disimpan")); return false; }
    if (!quiet) { setMsg({ tone: "ok", text: L("Draft saved", "Draf disimpan") }); refresh(); }
    return true;
  };
  const upload = async (files: FileList | null) => {
    if (!d || !files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const r = await csrfFetch(`/api/v1/staff/live-reports/${d.report.id}/files`, { method: "POST", headers: { "content-type": f.type || "image/png", "x-file-name": f.name.slice(0, 120) }, body: f });
      if (!r.ok) { const j = await r.json().catch(() => null) as { error?: { message?: string } } | null; setMsg({ tone: "bad", text: j?.error?.message ?? L("The screenshot was not attached", "Tangkapan skrin tidak dilampirkan") }); break; }
    }
    setBusy(false); refresh();
  };
  const submit = async () => {
    if (!d) return;
    setBusy(true);
    if (await saveDraft(true)) {
      const r = await api(`/staff/live-reports/${d.report.id}/submit`, { method: "POST", body: "{}" });
      if (r.ok) setMsg({ tone: "ok", text: L("Submitted for review", "Dihantar untuk semakan") }); else fail(r, L("Not submitted", "Tidak dihantar"));
    }
    setBusy(false); refresh();
  };
  const act = async (action: "review" | "accept" | "return" | "reopen") => {
    if (!d) return;
    let note = "";
    if (action === "return" || action === "reopen") {
      const got = await prompt({ title: action === "return" ? L("Return for correction?", "Pulangkan untuk pembetulan?") : L("Reopen this report?", "Buka semula laporan ini?"), message: L("The host sees your words and corrects the report as a new version.", "Hos melihat kata-kata anda dan membetulkan laporan sebagai versi baharu."), label: action === "return" ? L("What to correct (at least 10 characters)", "Apa yang perlu dibetulkan (sekurang-kurangnya 10 aksara)") : L("Why it is reopened (at least 10 characters)", "Sebab dibuka semula (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: action === "return" ? L("Return", "Pulangkan") : L("Reopen", "Buka semula") });
      if (!got) return;
      note = got.value;
    }
    setBusy(true);
    const r = await api(`/staff/live-reports/${d.report.id}/review`, { method: "POST", body: JSON.stringify({ action, note }) });
    setBusy(false);
    if (r.ok) setMsg({ tone: "ok", text: action === "accept" ? L("Accepted", "Diterima") : action === "review" ? L("Marked reviewed", "Ditanda disemak") : L("Returned to the host", "Dipulangkan kepada hos") }); else fail(r, L("Not done", "Tidak dibuat"));
    refresh();
  };
  const mine = (list?.reports ?? []).filter((r) => r.host_user_id === list?.me);
  const toReview = (list?.reports ?? []).filter((r) => r.host_user_id !== list?.me && ["submitted", "reviewed"].includes(r.state));
  const others = (list?.reports ?? []).filter((r) => r.host_user_id !== list?.me && !["submitted", "reviewed"].includes(r.state)).slice(0, 5);
  const latest = d?.versions[0];
  const draftFiles = (d?.files ?? []).filter((f) => f.version === null);
  const shownFiles = d ? (d.can.edit ? draftFiles : d.files.filter((f) => f.version === d.report.current_version)) : [];
  const st = d ? LR_STATE[d.report.state] : undefined;
  const row = (r: LrRow) => (
    <li key={r.id}><button type="button" onClick={() => { setOpen(r.id); setMsg(null); setHistory(false); }} aria-pressed={open === r.id}>
      <span className={t5.datePill}>{shortDay(r.session_date)}</span>
      <span className={t5.itemText}><strong>{r.platform} · {r.start_time.slice(0, 5)}{list?.can_review && r.host_name ? ` · ${r.host_name}` : ""}</strong><small>{rm(r.gmv_cents ?? r.draft_gmv_cents)} · {L(`${r.file_count} screenshot(s)`, `${r.file_count} tangkapan skrin`)}</small></span>
      <span className={LR_STATE[r.state]?.[2] ?? chipSmNeutral}>{LR_STATE[r.state] ? L(LR_STATE[r.state]![0], LR_STATE[r.state]![1]) : r.state}</span>
    </button></li>
  );
  return (
    <section className={card} aria-label={L("Live Host Report", "Laporan Hos Live")} data-testid="live-host-card">
      {promptNode}
      <Head5 icon="live" title={L("Live Host Report", "Laporan Hos Live")} sub={L("Submit or review a live host report with session, GMV, screenshot evidence and notes.", "Hantar atau semak laporan hos live dengan sesi, GMV, bukti tangkapan skrin dan nota.")}
        aside={st ? <span className={st[2]} data-testid="lh-state">{L(st[0], st[1])}</span> : undefined} />
      <p className={t5.note}>{L("Reported GMV is the host's figure - it is never verified sales, cash, an invoice paid, commission or payroll.", "GMV dilaporkan ialah angka hos - bukan jualan disahkan, tunai, invois dibayar, komisen atau gaji.")}</p>
      {msg && <p className={msg.tone === "bad" ? t5.danger : t5.note} role={msg.tone === "bad" ? "alert" : "status"}>{msg.text}</p>}
      {list === null ? <SkelRows rows={4} /> : (
        <>
          {list.sessions_to_report.length > 0 && (
            <label className={t5.field}><span className={t5.note}>{L("Report a live on the roster", "Laporkan live dalam roster")}</span>
              <select className={selectClassSm} defaultValue="" onChange={(e) => { if (e.target.value) void start(Number(e.target.value)); }} data-testid="lh-session">
                <option value="">{L("Choose your live session…", "Pilih sesi live anda…")}</option>
                {list.sessions_to_report.map((x) => <option key={x.id} value={x.id}>{sessionWord(x)}{x.client_name ? ` · ${x.client_name}` : ""}</option>)}
              </select>
            </label>
          )}
          {toReview.length > 0 && <><p className={t5.subHead}><AppIcon name="verify" />{L(`To review (${toReview.length})`, `Untuk disemak (${toReview.length})`)}</p><ul className={t5.list} data-testid="lh-review-list">{toReview.map(row)}</ul></>}
          {mine.length > 0 && <><p className={t5.subHead}><AppIcon name="live" />{L("My reports", "Laporan saya")}</p><ul className={t5.list} data-testid="lh-mine">{mine.slice(0, 5).map(row)}</ul></>}
          {list.can_review && others.length > 0 && <><p className={t5.subHead}><AppIcon name="documents" />{L("Recent decisions", "Keputusan terkini")}</p><ul className={t5.list}>{others.map(row)}</ul></>}
          {list.sessions_to_report.length === 0 && mine.length === 0 && toReview.length === 0 && others.length === 0 && <p className={t5.empty}>{L("No live to report or review. A host reports a live once it is on the roster and has happened.", "Tiada live untuk dilapor atau disemak. Hos melaporkan live yang ada dalam roster dan telah berlaku.")}</p>}
        </>
      )}
      {open && d && (
        <div className={t5.lhForm} data-testid="lh-detail">
          <p className={t5.subHead}><AppIcon name="date" />{d.session ? sessionWord(d.session) : ""}{d.host ? ` · ${d.host}` : ""}{d.report.current_version ? ` · v${d.report.current_version}` : ""}</p>
          {d.can.edit ? (
            <>
              {d.reviews[0]?.action === "return" || d.reviews[0]?.action === "reopen" ? <p className={t5.danger} data-testid="lh-feedback">{L("To correct:", "Untuk dibetulkan:")} {d.reviews[0]!.note}</p> : null}
              <div className={t5.formGrid}>
                <label className={t5.field}><span className={t5.note}>{L("GMV reported (RM)", "GMV dilaporkan (RM)")}</span><input className={inputClassSm} inputMode="decimal" type="number" min="0" step="0.01" value={form.gmv} onChange={(e) => setForm((f) => ({ ...f, gmv: e.target.value }))} data-testid="lh-gmv" /></label>
                <label className={t5.field}><span className={t5.note}>{L("Session duration (minutes)", "Tempoh sesi (minit)")}</span><input className={inputClassSm} inputMode="numeric" type="number" min="0" value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))} data-testid="lh-duration" /></label>
                <label className={t5.field}><span className={t5.note}>{L("Company", "Syarikat")}</span>
                  <select className={selectClassSm} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} data-testid="lh-company">
                    <option value="">{L("Choose…", "Pilih…")}</option><option value="a2z">A2Z Creative Marketing</option><option value="azoo">AZ ONE Official</option>
                  </select></label>
              </div>
              <p className={t5.note}><strong>{L("Screenshot of GMV (required)", "Tangkapan skrin GMV (wajib)")}</strong> · {L("JPEG, PNG or WebP, up to 8 MB, up to 4", "JPEG, PNG atau WebP, hingga 8 MB, hingga 4")}</p>
              <div className={t5.shots}>
                {shownFiles.map((f) => <Shot key={f.id} rid={d.report.id} fid={f.id} name={f.file_name} />)}
                {draftFiles.length < 4 && <label className={t5.shotAdd}><AppIcon name="upload" /><span>{busy ? L("Uploading…", "Memuat naik…") : L("Upload", "Muat naik")}</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="lh-upload" /></label>}
              </div>
              <label className={t5.field}><span className={t5.note}>{L("Highlights", "Sorotan")}</span><textarea className={inputClassSm} rows={2} value={form.highlights} onChange={(e) => setForm((f) => ({ ...f, highlights: e.target.value }))} /></label>
              <label className={t5.field}><span className={t5.note}>{L("Blockers / Issues", "Halangan / Isu")}</span><textarea className={inputClassSm} rows={2} value={form.blockers} onChange={(e) => setForm((f) => ({ ...f, blockers: e.target.value }))} /></label>
              <label className={t5.field}><span className={t5.note}>{L("Next Actions", "Tindakan Seterusnya")}</span><textarea className={inputClassSm} rows={2} value={form.next_actions} onChange={(e) => setForm((f) => ({ ...f, next_actions: e.target.value }))} /></label>
              <div className={t5.pvActs}>
                <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void submit()} data-testid="lh-submit">{L("Submit for Review", "Hantar untuk Semakan")}</button>
                <button type="button" className={btnSm} disabled={busy} onClick={() => void saveDraft()} data-testid="lh-save">{L("Save Draft", "Simpan Draf")}</button>
                <button type="button" className={btnSm} onClick={() => setHistory((h) => !h)} data-testid="lh-history-btn">{L("View History", "Lihat Sejarah")}</button>
              </div>
            </>
          ) : (
            <>
              <div className={t5.facts}>
                <span className={t5.fact}><small>{L("GMV reported", "GMV dilaporkan")}</small><strong data-testid="lh-gmv-shown">{rm(latest?.gmv_cents)}</strong></span>
                <span className={t5.fact}><small>{L("Duration", "Tempoh")}</small><strong>{latest?.duration_min != null ? `${Math.floor(latest.duration_min / 60)}h ${latest.duration_min % 60}m` : "—"}</strong></span>
                <span className={t5.fact}><small>{L("Company", "Syarikat")}</small><strong>{latest?.company === "azoo" ? "AZ ONE Official" : latest?.company === "a2z" ? "A2Z Creative Marketing" : "—"}</strong></span>
              </div>
              <div className={t5.shots}>{shownFiles.map((f) => <Shot key={f.id} rid={d.report.id} fid={f.id} name={f.file_name} />)}</div>
              {latest?.highlights && <p className={t5.note}><strong>{L("Highlights:", "Sorotan:")}</strong> {latest.highlights}</p>}
              {latest?.blockers && <p className={t5.note}><strong>{L("Blockers:", "Halangan:")}</strong> {latest.blockers}</p>}
              {latest?.next_actions && <p className={t5.note}><strong>{L("Next actions:", "Tindakan seterusnya:")}</strong> {latest.next_actions}</p>}
              <div className={t5.pvActs}>
                {d.can.review && d.report.state === "submitted" && <button type="button" className={btnSm} disabled={busy} onClick={() => void act("review")} data-testid="lh-review">{L("Mark reviewed", "Tanda disemak")}</button>}
                {d.can.review && ["submitted", "reviewed"].includes(d.report.state) && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void act("accept")} data-testid="lh-accept">{L("Accept", "Terima")}</button>}
                {d.can.review && ["submitted", "reviewed"].includes(d.report.state) && <button type="button" className={btnSm} disabled={busy} onClick={() => void act("return")} data-testid="lh-return">{L("Return for correction", "Pulangkan untuk pembetulan")}</button>}
                {d.can.review && d.report.state === "accepted" && <button type="button" className={btnSm} disabled={busy} onClick={() => void act("reopen")} data-testid="lh-reopen">{L("Reopen…", "Buka semula…")}</button>}
                <button type="button" className={btnSm} onClick={() => setHistory((h) => !h)} data-testid="lh-history-btn">{L("View History", "Lihat Sejarah")}</button>
              </div>
            </>
          )}
          {history && (
            <ul className={t5.list} data-testid="lh-history" aria-label={L("Report audit trail", "Jejak audit laporan")}>
              {[...d.versions.map((v) => ({ k: `v${v.version}`, at: v.submitted_at, text: L(`Version ${v.version} submitted by ${v.by_name ?? "the host"} - ${rm(v.gmv_cents)}`, `Versi ${v.version} dihantar oleh ${v.by_name ?? "hos"} - ${rm(v.gmv_cents)}`) })),
                ...d.reviews.map((w) => ({ k: `r${w.id}`, at: w.created_at, text: `${({ review: L("Reviewed", "Disemak"), accept: L("Accepted", "Diterima"), return: L("Returned for correction", "Dikembalikan"), reopen: L("Reopened", "Dibuka semula") } as Record<string, string>)[w.action] ?? w.action} (v${w.version}) - ${w.by_name ?? ""}${w.note ? `: ${w.note}` : ""}` }))]
                .sort((a, b) => b.at.localeCompare(a.at)).map((x) => <li key={x.k}><span className={t5.row}><span className={t5.itemText}><strong>{x.text}</strong><small>{stamp(x.at)}</small></span></span></li>)}
              {d.versions.length + d.reviews.length === 0 && <li className={t5.empty}>{L("Nothing submitted yet.", "Belum ada yang dihantar.")}</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
