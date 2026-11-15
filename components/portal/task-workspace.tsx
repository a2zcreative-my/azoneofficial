"use client";

/* v1.319.0 - TASKS 2.0, STAGE 1 (the CEO's seven pictures, 15-11-2026;
   claude/TASKS-2.0-STAGE-0-AUDIT.md, T2-3 to T2-7). ONE TASK ON THE PAGE:

     layout "beside"   picture 2 - the task beside the My Tasks list: its
                       header, the four steps, Task Information and the
                       Current Stage, the Update Task form always open, and
                       Notes / Files / Activity
     layout "page"     picture 4 - the task as a full page: the facts strip,
                       description, checklist and attachments on the left;
                       flow and progress, recent activity and the discussion
                       on the right; Back to the list at the foot

   NOTHING HERE IS A SECOND TASK ENGINE. Every piece is task-progress.tsx's
   own (the drawer's): the same record (useTaskDetail), the same update form
   (UpdateSheet, drawn inline), the same review bar, files, activity and
   comments, the same routes. The four steps are the stored status and stage
   said in the one set of words (flowOf) - nothing is stored for them.
   What a person may do is what the server's `can` says, as in the drawer. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { LineTabs } from "@/components/ui/line-tabs";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { btnSm, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClass } from "@/lib/ui-styles";
import {
  ActivityPanel, ExtraFacts, FLOW, FilesPanel, Problem, ReviewBar, StateChip, StatusSummary, TitleBar, UpdateSheet, UpdatesComments,
  day, flowOf, flowWord, nextLine, stamp, tagOf, useTaskDetail, type FlowKey, type TaskDetail,
} from "@/components/portal/task-progress";
import ws from "./task-workspace.module.css";

type Move = "in_progress" | "waiting_client" | "blocked" | "review" | "closed";
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
export function FlowSteps({ d }: { d: TaskDetail }) {
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
function StatusMenu({ d, onPick }: { d: TaskDetail; onPick: (m: Move) => void }) {
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

function Card({ icon, title, aside, children, tone, testid, label }: { icon: Parameters<typeof AppIcon>[0]["name"]; title: ReactNode; aside?: ReactNode; children: ReactNode; tone?: "stage"; testid?: string; label?: string }) {
  return (
    <section className={`${ws.card} ${tone === "stage" ? ws.cardStage : ""}`} data-testid={testid} aria-label={label}>
      <header className={ws.cardHead}><span className={ws.cardIcon}><AppIcon name={icon} /></span><h3>{title}</h3>{aside && <span className={ws.cardAside}>{aside}</span>}</header>
      {children}
    </section>
  );
}

const dueWord = (d: TaskDetail, today: string): { text: string; late: boolean } | null => {
  const t = d.task;
  if (!t.deadline || t.status === "completed") return null;
  const n = Math.round((Date.parse(`${t.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return n < 0 ? { text: L(`${-n} day(s) overdue`, `lewat ${-n} hari`), late: true } : n === 0 ? { text: L("due today", "perlu siap hari ini"), late: false } : { text: L(`${n} day(s) left`, `${n} hari lagi`), late: false };
};

export function TaskWorkspace({ taskId, layout, info, checklist, foot, focusForm = false, onChanged, onBack, onFull }: {
  taskId: number; layout: "beside" | "page";
  /** the Tasks tab's own Task Information (with its Edit) and Deliverables checklist */
  info?: ReactNode; checklist?: ReactNode;
  /** acknowledge / delete - the commands the drawer's foot carries */
  foot?: ReactNode;
  /** opened from a row's "Update status": the form is brought into view */
  focusForm?: boolean;
  onChanged?: () => void; onBack?: () => void; onFull?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const { d, error } = useTaskDetail(taskId, tick);
  const [formKey, setFormKey] = useState<{ n: number; start?: Move }>({ n: 0 });
  const [side, setSide] = useState<"notes" | "files" | "activity">("notes");
  const [actAll, setActAll] = useState(false);
  const [today] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const { show: toast, node: toastNode } = useSaveToast();
  const formRef = useRef<HTMLDivElement>(null);
  const changed = (title?: string, sub?: string) => { if (title) toast(title, sub ?? ""); setTick((n) => n + 1); setFormKey((k) => ({ n: k.n + 1 })); onChanged?.(); };
  const toForm = (start?: Move) => {
    if (start) setFormKey((k) => ({ n: k.n + 1, start }));
    window.setTimeout(() => { formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); formRef.current?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true }); }, 60);
  };
  const ready = Boolean(d);
  useEffect(() => {
    if (!focusForm || !ready) return;
    const id = window.setTimeout(() => { formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); formRef.current?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true }); }, 80);
    return () => window.clearTimeout(id);
  }, [focusForm, ready, taskId]);
  if (error) return <div className={ws.ws} data-testid="task-workspace" data-layout={layout}><Problem text={error} />{onBack && <button type="button" className={btnSm} onClick={onBack}><AppIcon name="previous" />{L("Back to the list", "Kembali ke senarai")}</button>}</div>;
  if (!d) return <div className={ws.ws} data-testid="task-workspace" data-layout={layout} aria-busy><SkelRows rows={6} /></div>;
  const t = d.task;
  const done = t.items.filter((i) => i.done).length;
  const flow = flowOf(t.status, t.stage);
  const due = dueWord(d, today);
  const canForm = (d.can.update || d.can.close) && t.status !== "completed";
  const n = t.counts.updates + (t.counts.comments ?? 0);
  const sideTabs = [
    ["notes", L("Notes", "Nota"), n, L("Notes", "Nota")],
    ["files", L("Files", "Fail"), t.counts.files],
    ["activity", L("Activity", "Aktiviti")],
  ] as const;
  const project = t.link ? [t.link.label, t.link.quotation].filter(Boolean).join(" · ") : null;

  const stageCard = (
    <Card icon="target" tone="stage" testid="ws-stage" label={L("Current stage", "Tahap semasa")}
      title={<><span className={ws.eyebrow}>{L("Current Stage", "Tahap Semasa")}</span>{flow ? flowWord(flow) : L("Cancelled", "Dibatalkan")}</>}
      aside={<strong className={ws.pct}>{t.progress}%</strong>}>
      <span className={ws.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.progress} aria-label={L("Progress", "Kemajuan")}><span style={{ width: `${t.progress}%` }} data-done={t.status === "completed" || undefined} /></span>
      <p className={ws.note}>{t.progress_source === "checklist" && t.items.length ? L(`From the checklist: ${done} of ${t.items.length} done.`, `Daripada senarai semak: ${done} daripada ${t.items.length} siap.`) : L("Reported by the person doing it.", "Dilaporkan oleh pelaksana.")}</p>
      <ReviewBar d={d} bare onChanged={changed} onUpdate={() => toForm("review")} onClose={() => toForm("closed")} />
    </Card>
  );
  const formCard = canForm ? (
    <div ref={formRef} className={ws.formWrap}>
      <Card icon="edit" title={L("Update Task", "Kemas Kini Tugasan")} testid="ws-update" label={L("Update task", "Kemas kini tugasan")}>
        <UpdateSheet key={`${t.id}:${formKey.n}`} inline d={d} start={formKey.start} onClose={() => undefined} onDone={(a, b) => changed(a, b)} />
      </Card>
    </div>
  ) : null;
  const sideCard = (
    <section className={ws.card} data-testid="ws-side" aria-label={L("Notes, files and activity", "Nota, fail dan aktiviti")}>
      <LineTabs value={side} onChange={setSide} tabs={sideTabs} label={L("Task record", "Rekod tugasan")} />
      <div className={ws.sideBody}>
        {side === "notes" && <><StatusSummary d={d} tick={tick} onSeeAll={() => setSide("notes")} /><UpdatesComments d={d} tick={tick} onChanged={changed} onUpdate={() => toForm()} /></>}
        {side === "files" && <FilesPanel d={d} tick={tick} onChanged={changed} />}
        {side === "activity" && <ActivityPanel taskId={t.id} tick={tick} />}
      </div>
    </section>
  );

  if (layout === "beside") {
    return (
      <>
      {toastNode /* a fixed layer of its own: never inside the panel it speaks for */}
      <div className={ws.ws} data-testid="task-workspace" data-layout="beside" data-record={`task:${t.id}`}>
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
          <span className={ws.headCmds}>
            <StatusMenu d={d} onPick={toForm} />
            {onFull && <button type="button" className={btnSm} onClick={onFull} data-testid="ws-full" aria-label={L("Open the full page", "Buka halaman penuh")} title={L("Open the full page", "Buka halaman penuh")}><AppIcon name="external" /></button>}
          </span>
        </header>
        <FlowSteps d={d} />
        <div className={ws.two}>
          {/* the Tasks tab's own Task information (its heading and Edit), drawn flat in this card */}
          <section className={`${ws.card} ${ws.flat}`} data-testid="ws-info" aria-label={L("Task information", "Maklumat tugasan")}>
            {info}
            <ExtraFacts d={d} onChanged={changed} brief={Boolean(info)} />
            {foot && <div className={ws.foot}>{foot}</div>}
          </section>
          <div className={ws.stack}>
            {stageCard}
            {checklist && <div className={`${ws.card} ${ws.flat}`} data-testid="ws-checklist">{checklist}</div>}
          </div>
        </div>
        <div className={ws.two}>
          {formCard ?? <div />}
          {sideCard}
        </div>
      </div>
      </>
    );
  }

  /* ---------------- picture 4: the full page ---------------- */
  return (
    <>
    {toastNode}
    <div className={ws.ws} data-testid="task-workspace" data-layout="page" data-record={`task:${t.id}`}>
      <nav className={ws.crumbs} aria-label={L("Where you are", "Lokasi anda")}>
        <button type="button" onClick={onBack} data-testid="ws-crumb">{L("Tasks", "Tugasan")}</button><AppIcon name="next" className="erp-icon" /><span aria-current="page">{L("Task Detail", "Butiran Tugasan")}</span>
      </nav>
      <section className={ws.card} aria-label={L("Task", "Tugasan")}>
        <div className={ws.head}>
          <span className={ws.headIcon}><AppIcon name="orders" /></span>
          <div className={ws.headText}><TitleBar d={d} onChanged={changed} /></div>
        </div>
        <dl className={ws.strip} data-testid="ws-strip">
          <div><dt>{L("Current Status", "Status Semasa")}</dt><dd><StatusMenu d={d} onPick={toForm} /></dd></div>
          <div><dt>{L("Priority", "Keutamaan")}</dt><dd><PriorityChip priority={t.priority} /></dd></div>
          <div><dt>{L("Due Date", "Tarikh Akhir")}</dt><dd className={due?.late ? ws.late : ""}><AppIcon name="date" className="erp-icon" />{t.deadline ? day(t.deadline) : L("No due date", "Tiada tarikh akhir")}{due && <small> ({due.text})</small>}</dd></div>
          <div><dt>{L("Assigned To", "Ditugaskan Kepada")}</dt><dd className={ws.who}>{t.assignee ? <><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}</span></> : "—"}{t.assistants.length > 0 && <span className={chipSmNeutral} title={t.assistants.map((a) => a.name).join(", ")}>+{t.assistants.length}</span>}</dd></div>
          <div><dt>{L("Project / Category", "Projek / Kategori")}</dt><dd>{project ?? <span className={ws.muted}>{L("Not linked", "Tidak dipautkan")}</span>}</dd></div>
        </dl>
      </section>
      <div className={ws.two}>
        <div className={ws.stack}>
          {/* the Tasks tab's own Task information (its heading, the description and Edit), drawn flat in this card */}
          <section className={`${ws.card} ${ws.flat}`} data-testid="ws-info" aria-label={L("Task information", "Maklumat tugasan")}>
            {info}
            <ExtraFacts d={d} onChanged={changed} brief={Boolean(info)} />
          </section>
          {checklist && <div className={`${ws.card} ${ws.flat}`} data-testid="ws-checklist">{checklist}</div>}
          <Card icon="attach" title={L(`Attachments (${t.counts.files})`, `Lampiran (${t.counts.files})`)} testid="ws-files" label={L("Attachments", "Lampiran")}>
            <FilesPanel d={d} tick={tick} onChanged={changed} />
          </Card>
        </div>
        <div className={ws.stack}>
          <Card icon="chart" title={L("Flow & Progress", "Aliran & Kemajuan")} testid="ws-flow" label={L("Flow and progress", "Aliran dan kemajuan")}
            aside={<span className={ws.overall}>{L("Overall progress", "Kemajuan keseluruhan")}<span className={ws.track}><span style={{ width: `${t.progress}%` }} data-done={t.status === "completed" || undefined} /></span><strong>{t.progress}%</strong></span>}>
            <FlowSteps d={d} />
            <p className={ws.note} data-testid="ws-next">{nextLine(d)}</p>
            <ReviewBar d={d} bare onChanged={changed} onUpdate={() => toForm("review")} onClose={() => toForm("closed")} />
          </Card>
          <Card icon="refresh" title={L("Recent Activity", "Aktiviti Terkini")} testid="ws-activity" label={L("Recent activity", "Aktiviti terkini")}
            aside={<button type="button" className={btnSm} onClick={() => setActAll((v) => !v)} aria-expanded={actAll} data-testid="ws-activity-all">{actAll ? L("Show fewer", "Tunjuk kurang") : L("View all", "Lihat Semua")}</button>}>
            {/* picture 4: the latest five; View all opens the whole record in place - nothing is cut off behind a scroll */}
            <div className={ws.clip} data-open={actAll}><ActivityPanel taskId={t.id} tick={tick} /></div>
          </Card>
          <Card icon="chat" title={L(`Comments & Discussion (${n})`, `Komen & Perbincangan (${n})`)} testid="ws-notes" label={L("Comments and discussion", "Komen dan perbincangan")}>
            <StatusSummary d={d} tick={tick} onSeeAll={() => document.querySelector<HTMLElement>("[data-testid=task-feed]")?.scrollIntoView({ block: "nearest" })} />
            <UpdatesComments d={d} tick={tick} onChanged={changed} onUpdate={() => toForm()} />
          </Card>
        </div>
      </div>
      {formCard}
      <div className={ws.bar} data-testid="ws-bar">
        <button type="button" className={btnSm} onClick={onBack} data-testid="ws-back"><AppIcon name="previous" />{L("Back to the list", "Kembali ke Senarai")}</button>
        {foot && <span className={ws.barCmds}>{foot}</span>}
      </div>
    </div>
    </>
  );
}
