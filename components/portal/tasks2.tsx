"use client";

/* v1.319.0 - TASKS 2.0, STAGE 1 (the CEO's seven pictures, 15-11-2026;
   claude/TASKS-2.0-STAGE-0-AUDIT.md, "Proceed the recommend"). The screen
   pieces of the new Overview (picture 5), My Tasks (pictures 2 and 3) and
   the flow board. SCREENS ONLY: every figure is counted from the task rows
   the tab already loaded - the same rows its tiles and lists always read.
   Nothing here writes, nothing is stored, and a figure with no record
   behind it is not drawn (no "+12% this week" without the history).

   ONE ROW MODEL (audit D-3): rowOf() says once what a task's row shows -
   its step of the four, its tag, whether it is overdue or due soon, its
   project and its due words. The table row, the board card and the My
   Tasks card all draw that one answer. */

import { type ReactNode } from "react";
import { L, type Task } from "@/components/portal/page-shared";
import { StateChip, FLOW, flowOf, flowWord, stamp, type FlowKey } from "@/components/portal/task-progress";
import { PriorityChip } from "@/components/portal/task-workspace";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { TaskAssignees } from "@/components/portal/task-assignees"; // 21-11-2026 - a shared team task shown once
import { SkelRows } from "@/components/ui/skeleton";
import { type PageSize } from "@/components/ui/pagination-controls";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, type SortDir, type TableCol } from "@/components/portal/task-table";
import { btnSm, chipSmDanger, chipSmWarn } from "@/lib/ui-styles";
import { mondayOf2, mytDay, rowFacts, staffPerformance, weeklyDone, byUrgency2 } from "@/lib/task-flow";
import t2 from "./tasks2.module.css";

export { byUrgency2, mondayOf2 };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 17 Nov 2026 - the same on every device (never the browser's own spelling of a month) */
const longDay = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** "Madam Jariah - QT-1 · Madam Jariah": the company is said once */
const projName = (label: string) => { const i = label.lastIndexOf(" · "); return i > 0 && label.slice(0, i).includes(label.slice(i + 3)) ? label.slice(0, i) : label; };
export const taskNo = (id: number) => `TSK-${String(id).padStart(6, "0")}`;
/* ---------------- the one row model ---------------- */
export interface RowModel {
  flow: FlowKey | null; overdue: boolean; soon: boolean; done: boolean;
  project: string | null; due: string | null; pct: number;
}
export function rowOf(t: Task, today: string): RowModel {
  return { ...rowFacts(t, today), project: t.link_label ? projName(t.link_label) : null, due: t.deadline ? longDay(t.deadline) : null };
}

function Bar({ pct, done }: { pct: number; done?: boolean }) {
  return <span className={t2.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} data-done={done || pct >= 100 || undefined} /></span>;
}
function Marker({ m }: { m: RowModel }) {
  return m.overdue ? <span className={chipSmDanger} data-testid="overdue-mark">{L("Overdue", "Lewat")}</span> : m.soon ? <span className={chipSmWarn} data-testid="soon-mark">{L("Due soon", "Hampir Tamat")}</span> : null;
}
export function Head2({ icon, title, sub, aside }: { /** v1.326.0 - none beside the task (the narrow register): the title and the switch share one line */ icon?: AppIconName; title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className={t2.head} data-bare={icon ? undefined : ""}>
      {icon && <span className={t2.headIcon}><AppIcon name={icon} /></span>}
      <span className={t2.headText}><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {aside && <span className={t2.headAside}>{aside}</span>}
    </header>
  );
}

/* ---------------- My Tasks: the card list (picture 2, left) ---------------- */
export function MyTaskCards({ rows, picked, onPick, today, loaded, empty }: { rows: Task[]; picked: number | null; onPick: (id: number) => void; today: string; loaded: boolean; empty: ReactNode }) {
  if (!loaded) return <SkelRows rows={5} />;
  if (rows.length === 0) return <>{empty}</>;
  return (
    <ul className={t2.myList} data-testid="my-cards">
      {rows.map((t) => {
        const m = rowOf(t, today);
        const on = picked === t.id;
        return (
          <li key={t.id}>
            <button type="button" className={t2.myCard} aria-pressed={on} data-record={`task:${t.id}`} data-overdue={m.overdue || undefined} onClick={() => onPick(t.id)}>
              <span className={t2.myIcon} aria-hidden><AppIcon name="orders" /></span>
              <span className={t2.myText}>
                <span className={t2.myTop}><strong>{t.title}</strong><span className={t2.myChips}><StateChip status={t.status} stage={t.stage ?? null} /><Marker m={m} /></span></span>
                {m.project && <small>{L("Project", "Projek")}: {m.project}</small>}
                <span className={t2.myFoot}>
                  <small className={m.overdue ? t2.late : ""}><AppIcon name="date" className="erp-icon" />{m.due ? `${L("Due", "Akhir")}: ${m.due}` : L("No due date", "Tiada tarikh akhir")}</small>
                  <span className={t2.myPct}><Bar pct={m.pct} done={m.done} /><b>{m.pct}%</b></span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- v1.326.0 - My Tasks from 1024px: the register beside the task ----------------
   The CEO's "Improve Tasks → My Tasks" (16-11-2026, the Project Register
   pictures): the list on the left is the one compact task table - the task
   and its project and due day, its state, its progress - with the task on
   show marked gold, pages of rows, and the rows filling the screen. Same
   rows, same order, same filters as the cards it replaces at this width
   (MyTaskCards stays the list below 1024px, where a task opens full screen). */
export function MyTaskTable({ rows, picked, onPick, today, loaded, empty, sort, dir, onSort, page, size, onPage, onSize }: {
  rows: Task[]; picked: number | null; onPick: (id: number) => void; today: string; loaded: boolean; empty: ReactNode;
  sort?: string; dir?: SortDir; onSort?: (key: string) => void;
  page: number; size: number; onPage: (p: number) => void; onSize: (s: PageSize) => void;
}) {
  const cols: TableCol<Task>[] = [
    { key: "task", label: L("Task", "Tugasan"), sort: "title", main: true, cell: (t) => {
      const m = rowOf(t, today);
      return (<>
        <TaskRowTitle title={t.title} onOpen={() => onPick(t.id)} />
        <TaskRowSub>
          {m.project && <span>{L("Project", "Projek")}: {m.project}</span>}
          {/* the due day says itself whether it is late or close - one line, no second chip */}
          <span data-late={m.overdue || undefined} data-testid="due-line">{!m.due ? L("No due date", "Tiada tarikh akhir") : `${m.overdue ? L("Overdue", "Lewat") : m.soon ? L("Due soon", "Hampir tamat") : L("Due", "Akhir")}: ${m.due}`}</span>
        </TaskRowSub>
      </>);
    } },
    { key: "status", label: L("Status", "Status"), sort: "status", cell: (t) => <StateChip status={t.status} stage={t.stage ?? null} /> },
    { key: "progress", label: L("Progress", "Kemajuan"), sort: "progress", cell: (t) => { const m = rowOf(t, today); return <span className={t2.myPct}><Bar pct={m.pct} done={m.done} /><b>{m.pct}%</b></span>; } },
  ];
  return (
    <CompactTaskTable rows={rows} cols={cols} label={L("My Tasks", "Tugasan Saya")} loading={!loaded} empty={empty} testid="mine-table"
      sort={sort} dir={dir} onSort={onSort} onOpen={onPick} picked={picked} dense fill
      page={page} size={size} onPage={onPage} onSize={onSize} />
  );
}

/* ---------------- the flow board (pictures 1 and 3): four columns, the four words ---------------- */
const COL: Record<FlowKey, [AppIconName, string, string]> = {
  todo: ["document", "Not started yet", "Belum dimulakan"],
  in_progress: ["next", "Being worked on", "Sedang dilaksanakan"],
  review: ["pending", "Waiting for review or approval", "Menunggu semakan / kelulusan"],
  done: ["success", "Completed", "Telah disiapkan"],
};
export function FlowBoard({ rows, today, onOpen, onAdd, onAllDone, showWho, limit = 0, foot }: {
  rows: Task[]; today: string; onOpen: (id: number) => void; onAdd?: () => void; onAllDone?: () => void; showWho: boolean; limit?: number;
  /** the row's own commands (acknowledge, delete) under a card */
  foot?: (t: Task) => ReactNode;
}) {
  return (
    <div className={t2.board} data-testid="flow-board">
      {FLOW.map((k) => {
        const all = rows.filter((t) => flowOf(t.status, t.stage ?? null) === k);
        const col = limit ? all.slice(0, limit) : all;
        return (
          <section key={k} className={t2.col} data-flow={k} aria-label={flowWord(k)}>
            <header className={t2.colHead}>
              <span className={t2.colIcon}><AppIcon name={COL[k][0]} /></span>
              <span className={t2.colText}><strong>{flowWord(k)}<span className={t2.count}>{all.length}</span></strong><small>{L(COL[k][1], COL[k][2])}</small></span>
              {onAdd && k !== "done" && <button type="button" className={t2.colAdd} onClick={onAdd} aria-label={L(`Add a task - ${flowWord(k)}`, `Tambah tugasan - ${flowWord(k)}`)}><AppIcon name="add" /></button>}
            </header>
            {col.length === 0 ? <p className={t2.colEmpty}>{L("Nothing here.", "Tiada apa-apa di sini.")}</p> : col.map((t) => {
              const m = rowOf(t, today);
              return (
                <article key={t.id} className={t2.bCard} data-record={`task:${t.id}`} data-prio={t.priority} data-overdue={m.overdue || undefined}>
                  <button type="button" className={t2.bTitle} onClick={() => onOpen(t.id)}>{t.title}</button>
                  {m.project && <small className={t2.bLine}><AppIcon name="folder" className="erp-icon" />{m.project}</small>}
                  <span className={t2.bRow}>
                    {k === "done" ? <StateChip status={t.status} stage={t.stage ?? null} /> : <PriorityChip priority={t.priority} />}
                    <small className={m.overdue ? t2.late : ""}><AppIcon name="date" className="erp-icon" />{k === "done" && t.closed_at ? longDay(mytDay(t.closed_at)) : m.due ?? "—"}</small>
                  </span>
                  {(k === "in_progress" || k === "review") && <span className={t2.bPct}><b>{m.pct}%</b><Bar pct={m.pct} /></span>}
                  <span className={t2.bRow}>
                    {showWho && t.assignee ? <TaskAssignees t={t} whoClass={t2.who} mutedClass={t2.muted} /> : <span />}
                    <span className={t2.myChips}><Marker m={m} />{t.stage && t.stage !== "review" && t.status !== "completed" && <StateChip status={t.status} stage={t.stage} />}</span>
                  </span>
                  {foot && <span className={t2.bFoot}>{foot(t)}</span>}
                </article>
              );
            })}
            {limit > 0 && all.length > col.length && <p className={t2.colEmpty}>{L(`and ${all.length - col.length} more`, `dan ${all.length - col.length} lagi`)}</p>}
            {k === "done" ? (onAllDone && all.length > 0 && <button type="button" className={t2.colMore} onClick={onAllDone}><AppIcon name="add" />{L("View all done", "Lihat Semua Selesai")}</button>)
              : onAdd && <button type="button" className={t2.colMore} onClick={onAdd}><AppIcon name="add" />{L("Add Task", "Tambah Tugas")}</button>}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- Overview: the table (picture 5) ---------------- */
export function OverviewTable({ rows, today, onOpen, showWho, label }: { rows: Task[]; today: string; onOpen: (id: number) => void; showWho: boolean; label: string }) {
  return (
    <div className={`erp-table-scroll ${t2.tableWrap}`}>
      <table className={t2.table} aria-label={label} data-testid="overview-table">
        <thead>
          <tr>
            <th>{L("Task Title", "Tajuk Tugas")}</th>
            <th>{L("Project / Client", "Projek / Klien")}</th>
            {showWho && <th>{L("Assigned To", "Diberi Kepada")}</th>}
            <th>{L("Priority", "Keutamaan")}</th>
            <th>{L("Due Date", "Tarikh Akhir")}</th>
            <th>{L("Status", "Status")}</th>
            <th>{L("Progress", "Kemajuan")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const m = rowOf(t, today);
            return (
              <tr key={t.id} data-record={`task:${t.id}`} data-overdue={m.overdue || undefined}>
                <td data-label={L("Task", "Tugas")}><button type="button" className={t2.rowTitle} onClick={() => onOpen(t.id)}>{t.title}</button><small className={t2.rowNo}>{taskNo(t.id)}</small></td>
                <td data-label={L("Project / Client", "Projek / Klien")}>{m.project ?? <span className={t2.muted}>—</span>}</td>
                {showWho && <td data-label={L("Assigned To", "Diberi Kepada")}><TaskAssignees t={t} whoClass={t2.who} mutedClass={t2.muted} /></td>}
                <td data-label={L("Priority", "Keutamaan")}><PriorityChip priority={t.priority} /></td>
                <td data-label={L("Due Date", "Tarikh Akhir")} className={m.overdue ? t2.late : ""}><span className={t2.dueCell}><AppIcon name="date" className="erp-icon" />{m.due ?? "—"}</span>{(m.overdue || m.soon) && <span className={t2.dueMark}><Marker m={m} /></span>}</td>
                <td data-label={L("Status", "Status")}><StateChip status={t.status} stage={t.stage ?? null} /></td>
                <td data-label={L("Progress", "Kemajuan")}><span className={t2.pctCell}><Bar pct={m.pct} done={m.done} /><b>{m.pct}%</b></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Overview: Staff Performance (picture 5; T2-14 - managers only) ----------------
   THE RULE, said on the card: of the tasks a person held this week (assigned
   to them and open at any time since Monday), how many they closed this
   week. Counted from the loaded rows; a cancelled task is left out. */
export function StaffPerformance({ tasks, today, onPick }: { tasks: Task[]; today: string; onPick: (id: number) => void }) {
  const rows = staffPerformance(tasks, today);
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("Staff performance", "Prestasi staf")} data-testid="staff-performance">
      <Head2 icon="users" title={L("Staff Performance (Tasks)", "Prestasi Staf (Tugasan)")} aside={<span className={t2.period}>{L("This week", "Minggu Ini")}</span>} />
      {rows.length === 0 ? <p className={t2.empty}>{L("No task was held this week.", "Tiada tugasan dipegang minggu ini.")}</p> : (
        <ol className={t2.perf}>
          {rows.slice(0, 5).map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p.id)} aria-label={L(`${p.name}: ${p.closed} of ${p.held} closed this week`, `${p.name}: ${p.closed} daripada ${p.held} ditutup minggu ini`)}>
                <span className={t2.rank} data-first={i === 0 || undefined}>{i + 1}</span>
                <Avatar name={p.name} photoKey={p.photo} size="sm" />
                <span className={t2.perfName}>{p.name}</span>
                <span className={t2.perfBar}><Bar pct={p.pct} done /></span>
                <span className={t2.perfNum}>{p.closed} / {p.held} <em>({p.pct}%)</em></span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className={t2.note} data-testid="perf-rule">{L("Closed this week ÷ tasks held this week (Monday to today). Cancelled tasks are left out.", "Ditutup minggu ini ÷ tugasan dipegang minggu ini (Isnin hingga hari ini). Tugasan dibatalkan tidak dikira.")}</p>
    </section>
  );
}

/* ---------------- Overview: My Tasks today (picture 1), for a person with no team ---------------- */
export function MyToday({ mine, today, onAll }: { mine: Task[]; today: string; onAll: () => void }) {
  const open = mine.filter((t) => t.status !== "completed");
  const n = { todo: open.filter((t) => t.status === "open").length, doing: open.filter((t) => t.status === "in_progress").length, late: open.filter((t) => !!t.deadline && t.deadline < today).length };
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("My tasks today", "Tugasan saya hari ini")} data-testid="my-today">
      <Head2 icon="orders" title={L("My Tasks (Today)", "Tugasan Saya (Hari Ini)")} aside={<button type="button" className={btnSm} onClick={onAll}>{L("View all", "Lihat Semua")}<AppIcon name="next" /></button>} />
      <dl className={t2.three}>
        <div><dd>{n.todo}</dd><dt>{L("To Do", "Perlu Dilaksana")}</dt></div>
        <div><dd>{n.doing}</dd><dt>{L("In Progress", "Dalam Proses")}</dt></div>
        <div data-late={n.late > 0 || undefined}><dd>{n.late}</dd><dt>{L("Overdue", "Tertunggak")}</dt></div>
      </dl>
    </section>
  );
}

/* ---------------- Overview: Quick Links ---------------- */
export function QuickLinks({ items }: { items: { icon: AppIconName; label: string; onClick: () => void; testid?: string }[] }) {
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("Quick links", "Pautan pantas")} data-testid="quick-links">
      <Head2 icon="link" title={L("Quick Links", "Pautan Pantas")} />
      <div className={t2.links}>
        {items.map((it) => <button key={it.label} type="button" onClick={it.onClick} data-testid={it.testid}><span><AppIcon name={it.icon} /></span>{it.label}</button>)}
      </div>
    </section>
  );
}

/* ---------------- Overview: Recent Activity (the latest progress reports - never a comment) ---------------- */
export function ActivityFeed({ rows, onOpen, onAll }: { rows: Task[]; onOpen: (id: number) => void; onAll?: () => void }) {
  const recent = rows.filter((t) => t.latest_update).sort((a, b) => b.latest_update!.at.localeCompare(a.latest_update!.at)).slice(0, 5);
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("Recent Activity", "Aktiviti Terkini")} data-testid="progress-overview">
      <Head2 icon="time" title={L("Recent Activity", "Aktiviti Terkini")} sub={L("The latest progress reports, newest first.", "Laporan kemajuan terkini, terbaru dahulu.")}
        aside={onAll && <button type="button" className={btnSm} onClick={onAll}>{L("View all", "Lihat Semua")}</button>} />
      {recent.length === 0 ? <p className={t2.empty}><AppIcon name="info" />{L("No progress reports yet.", "Belum ada laporan kemajuan.")}</p> : (
        <ol className={t2.feed}>
          {recent.map((t) => (
            <li key={t.id} data-kind={t.latest_update!.kind}>
              <button type="button" onClick={() => onOpen(t.id)}>
                <span className={t2.feedDot} aria-hidden><AppIcon name={t.status === "completed" ? "success" : t.stage === "review" ? "pending" : "edit"} /></span>
                <span className={t2.feedText}><strong>{t.title}</strong><small>{t.latest_update!.by ?? "—"} — {t.latest_update!.body.slice(0, 90)}</small><time className={t2.feedTime}>{stamp(t.latest_update!.at)}</time></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------------- Overview: the workflow, as it really runs (pictures 5 and 7) ---------------- */
export function WorkflowStrip() {
  const steps: [FlowKey, AppIconName, string, string][] = [
    ["todo", "document", L("Create Task", "Cipta Tugas"), L("Title, the person responsible, due date and priority", "Tajuk, staf bertanggungjawab, tarikh & keutamaan")],
    ["in_progress", "next", L("In Progress", "Dalam Progres"), L("The person does the work and reports progress", "Staf laksanakan & kemas kini kemajuan")],
    ["review", "search", L("Review", "Semakan"), L("Approved or returned by whoever set it, the Project Owner or management", "Diluluskan atau dikembalikan oleh yang menetapkan, Pemilik Projek atau pengurusan")],
    ["done", "success", L("Done", "Selesai"), L("Closed with a summary and kept on record", "Ditutup dengan ringkasan & direkodkan")],
  ];
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("Task workflow", "Aliran kerja tugas")} data-testid="workflow-strip">
      <Head2 icon="refresh" title={L("Task Workflow", "Aliran Kerja Tugas (Workflow)")} />
      <ol className={t2.wf}>
        {steps.map(([k, icon, title, sub]) => <li key={k} data-flow={k}><span className={t2.wfIcon}><AppIcon name={icon} /></span><strong>{title}</strong><small>{sub}</small></li>)}
      </ol>
    </section>
  );
}

/* ---------------- Overview: Weekly Summary - tasks closed each day this week ---------------- */
export function WeeklySummary({ tasks, today }: { tasks: Task[]; today: string }) {
  const rows = weeklyDone(tasks, today);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const DAY = [["Mon", "Isn"], ["Tue", "Sel"], ["Wed", "Rab"], ["Thu", "Kha"], ["Fri", "Jum"], ["Sat", "Sab"], ["Sun", "Ahd"]] as const;
  return (
    <section className={`erp-card ${t2.cardGap}`} aria-label={L("Weekly summary", "Ringkasan mingguan")} data-testid="weekly-summary">
      <Head2 icon="chart" title={L("Weekly Summary", "Ringkasan Mingguan")} sub={L(`Tasks closed each day this week · ${total} so far`, `Tugasan ditutup setiap hari minggu ini · ${total} setakat ini`)} />
      <ol className={t2.week} aria-label={L("Tasks closed per day", "Tugasan ditutup setiap hari")}>
        {rows.map((r, i) => (
          <li key={r.day} data-today={r.day === today || undefined} data-future={r.day > today || undefined}>
            <b>{r.day > today ? "" : r.n}</b>
            <span className={t2.weekBar} style={{ height: `${r.day > today ? 0 : Math.max(4, Math.round((r.n / max) * 100))}%` }} data-zero={r.n === 0 || undefined} />
            <small>{L(DAY[i]![0], DAY[i]![1])}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
