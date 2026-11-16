"use client";

/* v1.321.0 - THE TASK PANE (the CEO's "Tasks Module Unified Workspace
   Redesign", 16-11-2026; before it, v1.319.0's beside and page layouts).
   ONE task, ONE layout, drawn in two places:
     - beside the My Tasks list (35% list, 65% task) from 1024px;
     - in the task drawer (TaskDetailDrawer) everywhere else, full screen on a phone.

   Top to bottom: the title bar, the facts (status, priority, due, owner), the
   compact horizontal StatusStepper, the decisions this person may take (the
   review bar - always visible, never behind a tab), then five sections -
   Details, Checklist, Updates, Files, Activity. Updates carries the ONE
   update composer: the drawer's own Add Status Update form drawn inline,
   which also posts a plain comment - the old Quick Update box is no longer
   a second composer.

   NOTHING HERE IS A SECOND TASK ENGINE. Every piece is task-progress.tsx's
   own: the same record (useTaskDetail), the same form (UpdateSheet), the same
   review bar, files, activity and comments, the same routes. What a person
   may do is what the server's `can` says. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import { LineTabs } from "@/components/ui/line-tabs";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClass } from "@/lib/ui-styles";
import {
  ActivityPanel, ExtraFacts, FLOW, FilesPanel, Problem, ReviewBar, StateChip, StatusSummary, TitleBar, UpdateSheet, UpdatesComments,
  day, flowOf, flowWord, stamp, tagOf, useTaskDetail, type FlowKey, type TaskDetail,
} from "@/components/portal/task-progress";
import ws from "./task-workspace.module.css";

type Move = "in_progress" | "waiting_client" | "blocked" | "review" | "closed" | "comment";
const PRIO: Record<string, [string, string, string]> = {
  urgent: ["High", "Tinggi", chipSmDanger], high: ["High", "Tinggi", chipSmDanger], normal: ["Medium", "Sederhana", chipSmWarn], low: ["Low", "Rendah", chipSmSuccess],
};
/** High / Medium / Low (T2-10); an urgent task is High with its flag */
export function PriorityChip({ priority }: { priority: string }) {
  const p = PRIO[priority] ?? [priority, priority, chipSmNeutral];
  return <span className={`${p[2]} ${ws.prio}`} data-testid="prio-chip">{priority === "urgent" && <AppIcon name="hot" className="erp-icon" />}{L(p[0], p[1])}{priority === "urgent" ? ` · ${L("Urgent", "Segera")}` : ""}</span>;
}

/* ---------------- the four steps (pictures 2, 4 and 7) ---------------- */
const stepAt = (d: TaskDetail, k: FlowKey): string | null => {
  const tl = d.task.timeline ?? [];
  const at = (key: string) => tl.find((s) => s.key === key && s.at)?.at ?? null;
  return k === "todo" ? d.task.created_at : k === "in_progress" ? at("in_progress") : k === "review" ? at("review") : at("closed") ?? d.task.closure?.at ?? null;
};
/** the compact horizontal stepper: To Do, In Progress, Review, Done - the step in hand, the day each was reached; Blocked, Waiting and Cancelled as its tag */
export function StatusStepper({ d }: { d: TaskDetail }) {
  const t = d.task;
  const flow = flowOf(t.status, t.stage);
  const tag = tagOf(t.status, t.stage);
  const now = flow ? FLOW.indexOf(flow) : -1;
  return (
    <ol className={ws.flow} aria-label={L("Task flow", "Aliran tugasan")} data-testid="flow-steps" data-now={flow ?? "cancelled"}>
      {FLOW.map((k, i) => {
        const state = flow === "done" || i < now ? "done" : i === now ? "now" : "todo";
        const at = state !== "todo" ? stepAt(d, k) : null;
        return (
          <li key={k} data-state={state} data-step={k}>
            <span className={ws.flowDot} aria-hidden>{state === "done" ? <AppIcon name="success" /> : state === "now" ? <AppIcon name="next" /> : null}</span>
            <span className={ws.flowText}>
              <strong>{flowWord(k)}</strong>
              <small>{at ? (k === "todo" ? stamp(at) : day(at)) : "—"}</small>
              {state === "now" && <em className={tag ? tag.cls : chipSmInfo}>{tag ? tag.label : L("Now", "Kini")}</em>}
            </span>
          </li>
        );
      })}
      {!flow && tag && <li data-state="off" className={ws.flowOff}><span className={tag.cls}>{tag.label}</span></li>}
    </ol>
  );
}

/** the moves this person may make, as the update form offers them (T2-7) */
function movesOf(d: TaskDetail): [Move, string][] {
  if (d.task.status === "completed") return [];
  const approving = d.task.stage === "review" && !d.can.self_set;
  return ([
    ["in_progress", L("In Progress", "Sedang Berjalan"), d.can.update],
    ["waiting_client", L("Waiting for Client", "Menunggu Pelanggan"), d.can.update],
    ["blocked", L("On Hold / Blocked", "Ditangguh / Terhalang"), d.can.update],
    ["review", L("Submit for Review", "Hantar untuk Semakan"), d.can.request_review],
    ["closed", approving ? L("Approve & Mark Done", "Lulus & Tanda Selesai") : L("Mark Done", "Tanda Selesai"), !!d.can.close],
  ] as [Move, string, boolean | undefined][]).filter((m) => m[2]).map((m) => [m[0], m[1]]);
}
export function StatusMenu({ d, onPick }: { d: TaskDetail; onPick: (m: Move) => void }) {
  const moves = movesOf(d);
  const flow = flowOf(d.task.status, d.task.stage);
  const word = flow ? flowWord(flow) : L("Cancelled", "Dibatalkan");
  if (moves.length === 0) return <StateChip status={d.task.status} stage={d.task.stage} />;
  return (
    <select className={`${selectClass} ${ws.statusMenu}`} data-flow={flow ?? "cancelled"} value="" aria-label={L("Current status - change it", "Status semasa - ubah")} data-testid="status-menu"
      onChange={(e) => { if (e.target.value) onPick(e.target.value as Move); }}>
      <option value="">{word}</option>
      {moves.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

const dueWord = (d: TaskDetail, today: string): { text: string; late: boolean } | null => {
  const t = d.task;
  if (!t.deadline || t.status === "completed") return null;
  const n = Math.round((Date.parse(`${t.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return n < 0 ? { text: L(`${-n} day(s) overdue`, `lewat ${-n} hari`), late: true } : n === 0 ? { text: L("due today", "perlu siap hari ini"), late: false } : { text: L(`${n} day(s) left`, `${n} hari lagi`), late: false };
};

type Section = "details" | "checklist" | "updates" | "files" | "activity";

export function TaskWorkspace({ taskId, layout, info, checklist, foot, focusForm = false, onChanged }: {
  taskId: number;
  /** "pane": beside the My Tasks list; "drawer": inside TaskDetailDrawer */
  layout: "pane" | "drawer";
  /** the Tasks tab's own Task Information (with its Edit) and Deliverables checklist */
  info?: ReactNode; checklist?: ReactNode;
  /** acknowledge / delete - the task's own commands */
  foot?: ReactNode;
  /** opened from a row's "Update": the composer opens on the status update */
  focusForm?: boolean;
  onChanged?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const { d, error } = useTaskDetail(taskId, tick);
  const [sec, setSec] = useState<Section>(focusForm ? "updates" : "details");
  const [sheet, setSheet] = useState<{ open: boolean; n: number; start?: Move }>({ open: focusForm, n: 0 });
  const [today] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const { show: toast, node: toastNode } = useSaveToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const changed = (title?: string, sub?: string) => { if (title) toast(title, sub ?? ""); setTick((n) => n + 1); setSheet((k) => ({ open: false, n: k.n + 1 })); onChanged?.(); };
  /* the status menu, the review bar and a row's Update all lead to the ONE composer */
  const toForm = (start?: Move) => {
    if (start === "comment") { setSec("updates"); setSheet((k) => ({ open: false, n: k.n + 1 })); }
    else { setSec("updates"); setSheet((k) => ({ open: true, n: k.n + 1, start })); }
    window.setTimeout(() => { bodyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); bodyRef.current?.querySelector<HTMLElement>("[data-testid=task-composer] textarea")?.focus({ preventScroll: true }); }, 80);
  };
  const ready = Boolean(d);
  useEffect(() => {
    if (!focusForm || !ready) return;
    const id = window.setTimeout(() => { bodyRef.current?.querySelector<HTMLElement>("[data-testid=task-composer] textarea")?.focus({ preventScroll: true }); }, 100);
    return () => window.clearTimeout(id);
  }, [focusForm, ready, taskId]);
  if (error) return <div className={ws.ws} data-testid="task-workspace" data-layout={layout} data-state="error"><Problem text={error} /></div>;
  if (!d) return <div className={ws.ws} data-testid="task-workspace" data-layout={layout} data-state="loading" aria-busy><SkelRows rows={6} /></div>;
  const t = d.task;
  const done = t.items.filter((i) => i.done).length;
  const due = dueWord(d, today);
  const canForm = (d.can.update || d.can.close) && t.status !== "completed";
  const n = t.counts.updates + (t.counts.comments ?? 0);
  const project = t.link ? [t.link.label, t.link.quotation].filter(Boolean).join(" · ") : null;
  const tabs: (readonly [Section, string, number | null | undefined])[] = [
    ["details", L("Details", "Butiran"), null],
    ...(checklist ? [["checklist", L("Checklist", "Senarai Semak"), t.items.length - done] as const] : []),
    ["updates", L("Updates", "Kemas Kini"), n],
    ["files", L("Files", "Fail"), t.counts.files],
    ["activity", L("Activity", "Aktiviti"), null],
  ];
  const composerSheet = canForm
    ? <UpdateSheet key={`${t.id}:${sheet.n}`} inline d={d} start={sheet.start === "comment" ? undefined : sheet.start} onClose={() => setSheet((k) => ({ ...k, open: false }))} onDone={(a, b) => changed(a, b)} />
    : null;

  return (
    <>
    {toastNode /* a fixed layer of its own: never inside the panel it speaks for */}
    <div className={ws.ws} data-testid="task-workspace" data-layout={layout} data-record={`task:${t.id}`}>
      <header className={ws.head}>
        <span className={ws.headIcon}><AppIcon name="orders" /></span>
        <div className={ws.headText}>
          <TitleBar d={d} onChanged={changed} />
          {(project || t.link?.customer) && (
            <p className={ws.headSub}>
              {project && <span><AppIcon name="folder" className="erp-icon" />{t.link?.kind === "project" ? L("Project", "Projek") : L("About", "Berkaitan")}: {project}</span>}
              {t.link?.customer && <span><AppIcon name="clients" className="erp-icon" />{L("Client", "Klien")}: {t.link.customer}</span>}
            </p>
          )}
        </div>
        <span className={ws.headCmds}><StatusMenu d={d} onPick={toForm} /></span>
      </header>
      {/* the facts a person checks first, in one line */}
      <dl className={ws.facts} data-testid="ws-facts">
        <div><dt>{L("Priority", "Keutamaan")}</dt><dd><PriorityChip priority={t.priority} /></dd></div>
        <div><dt>{L("Due", "Tarikh Akhir")}</dt><dd className={due?.late ? ws.late : ""} data-testid="ws-due">{t.deadline ? day(t.deadline) : L("No due date", "Tiada tarikh akhir")}{due && <small>{due.text}</small>}</dd></div>
        <div><dt>{L("Assigned to", "Ditugaskan kepada")}</dt><dd className={ws.who}>{t.assignee ? <><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}</span></> : "—"}{t.assistants.length > 0 && <span className={chipSmNeutral} title={t.assistants.map((a) => a.name).join(", ")}>+{t.assistants.length}</span>}</dd></div>
        <div><dt>{L("Progress", "Kemajuan")}</dt><dd className={ws.prog}>
          <span className={ws.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.progress} aria-label={L("Progress", "Kemajuan")}><span style={{ width: `${t.progress}%` }} data-done={t.status === "completed" || undefined} /></span>
          <strong>{t.progress}%</strong>
        </dd></div>
      </dl>
      <StatusStepper d={d} />
      {/* the decisions this person may take - never behind a tab */}
      <div data-testid="ws-decide"><ReviewBar d={d} bare onChanged={changed} onUpdate={() => toForm("review")} onClose={() => toForm("closed")} /></div>
      <div ref={bodyRef} className={ws.body}>
        <LineTabs value={sec} onChange={setSec} tabs={tabs} label={L("Task sections", "Bahagian tugasan")} />
        <div className={ws.sec} data-testid="ws-section" data-sec={sec}>
          {sec === "details" && (
            <div className={ws.flat} data-testid="ws-info">
              {/* where it stands - the latest report in full; See all opens Updates */}
              <StatusSummary d={d} tick={tick} onSeeAll={() => setSec("updates")} />
              {info}
              <ExtraFacts d={d} onChanged={changed} brief={Boolean(info)} />
              {foot && <div className={ws.foot} data-testid="ws-foot">{foot}</div>}
            </div>
          )}
          {sec === "checklist" && <div className={ws.flat} data-testid="ws-checklist">{checklist}</div>}
          {sec === "updates" && (<>
            <UpdatesComments d={d} tick={tick} onChanged={changed} onUpdate={() => toForm()}
              composer={composerSheet ? { open: sheet.open, setOpen: (v) => setSheet((k) => ({ open: v, n: v ? k.n : k.n + 1 })), sheet: composerSheet } : undefined} />
          </>)}
          {sec === "files" && <FilesPanel d={d} tick={tick} onChanged={changed} />}
          {sec === "activity" && <ActivityPanel taskId={t.id} tick={tick} />}
        </div>
      </div>
    </div>
    </>
  );
}

/** v1.321.0 - TaskDetailDrawer: the same pane in the side drawer - every tab
    but the My Tasks split opens a task here; full screen on a phone. */
export function TaskDetailDrawer({ taskId, title, subtitle, info, checklist, foot, focusForm, onClose, onChanged }: {
  taskId: number; title: string; subtitle?: ReactNode; info?: ReactNode; checklist?: ReactNode; foot?: ReactNode; focusForm?: boolean;
  onClose: () => void; onChanged?: () => void;
}) {
  return (
    <SideDrawer open onClose={onClose} wide full title={title} subtitle={subtitle}>
      <TaskWorkspace key={taskId} layout="drawer" taskId={taskId} info={info} checklist={checklist} foot={foot} focusForm={focusForm} onChanged={onChanged} />
    </SideDrawer>
  );
}
