"use client";

/* PROJECT WORKSPACE — v1.245.0.
 *
 * The owner's brief and reference pictures (desktop workspace, permission
 * matrix, mobile status update), approved 31-10-2026 with decisions P-1 to
 * P-6 (claude/PROJECT-WORKSPACE-AUDIT.md). The server decides every right
 * (worker/src/projects.ts) and sends `can`; this screen only shows what it
 * was given. Project tasks are ordinary tasks (POST /staff/tasks with
 * link_kind "project"); updates are append-only.
 *
 *   <ProjectWorkspace projectId />   the Project Task tab of a quotation, and
 *                                    the project opened from Tasks > Projects
 *   <ProjectActivity projectId />    the read-only timeline
 *   <ProjectFiles projectId />       the project's private files
 *   <ProjectsBoard />                Tasks > Projects: Mine / I'm on / All
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, csrfFetch } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { openCustomerFile } from "@/components/portal/customer-file";
import { btnClass, btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSmDanger, fieldLabel, inputClass, selectClass, textareaClass } from "@/lib/ui-styles";
import { TaskDrawer } from "@/components/portal/task-progress"; // v1.246.0 - a project row opens the task itself
import pw from "./project-workspace.module.css";

/** The staff list for the assignee and owner pickers; null until it lands (the pickers show a skeleton). */
type Staff = { id: number; name: string; role?: string; position?: string | null };
function useStaff(): Staff[] | null {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  useEffect(() => { void api<{ staff: Staff[] }>("/staff/staff-list").then((r) => setStaff(r.data?.staff ?? [])); }, []);
  return staff;
}

/* ---------------- shapes the server sends ---------------- */
export interface PTask {
  id: number; title: string; description: string | null; assigned_to: number; assignee: string; photo_key: string | null;
  status: "open" | "in_progress" | "completed"; stage: string | null; progress: number; priority: string; deadline: string | null; created_at: string;
  last_update_at: string | null; last_update_by: string | null; last_update: string | null; label: "not_started" | "in_progress" | "pending" | "review" | "completed" | "cancelled"; mine: boolean;
}
export interface PUpdate {
  id: number; task_id: number | null; task_title: string | null; author_id: number; author: string; photo_key: string | null; kind: string; body: string;
  completed_work: string | null; blockers: string | null; next_action: string | null; status_to: string | null; stage_to: string | null; progress_snapshot: number | null;
  corrects_id: number | null; created_at: string; files: { id: number; file_name: string; level: string; open: boolean }[];
}
export interface Workspace {
  project: {
    id: number; title: string; description: string | null; status: string; start_date: string | null; due_date: string | null; deliverables: string[];
    notes: string | null; version: number; created_at: string; activated_at: string | null; activation_reason: string | null; completed_at: string | null;
    cancelled_at: string | null; cancel_reason: string | null; completion_requested_at: string | null; completion_requested_by: string | null;
    owner: { id: number; name: string | null; set_at: string | null; set_by: string | null } | null; progress: number;
  };
  quotation: { id: number; doc_number: string; state: { label: string; accepted_at: string | null; accepted_name: string | null; invoice: string | null }; created_at: string; valid_until: string | null; revision: number; salesperson: { id: number; name: string | null } | null };
  client: { id: number; company: string; contact_person: string | null; phone?: string | null; email?: string | null } | null;
  package: { id: number; name: string; version: number | null; customized: boolean } | null;
  scope: { frozen: boolean; revision: number; revised_after_activation: boolean; lines: { name: string; qty: number; uom: string | null; sub: string[]; unit_price_cents?: number; line_cents?: number }[]; totals: { total_cents: number } | null };
  tasks: PTask[]; team: { id: number; name: string; photo_key: string | null }[]; updates: PUpdate[]; file_count: number;
  suggested_owner: { id: number; name: string | null } | null;
  can: { edit: boolean; add_task: boolean; assign_owner: boolean; update: boolean; assist: boolean; status: boolean; complete: boolean; prices: boolean; contact: boolean; files: boolean; restricted_files: boolean; is_owner: boolean; is_assigned: boolean; manage: boolean };
  transitions: { to: string; label: string; needs_reason?: boolean; blocked?: string }[];
}

/* ---------------- words ---------------- */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 20 Oct 2026 (the picture's form); a UTC stamp is read in Malaysia time. */
export function fmtDay(v: string | null | undefined): string {
  if (!v) return "—";
  const d = v.length > 10 ? new Date(Date.parse(v.replace(" ", "T") + (v.includes("Z") ? "" : "Z")) + 8 * 3600 * 1000) : new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtStamp(v: string): string {
  const d = new Date(Date.parse(v.replace(" ", "T") + (v.includes("Z") ? "" : "Z")) + 8 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return v;
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDay(v)}, ${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}
const rmc = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const PROJECT_STATUS: Record<string, [string, string, string]> = {
  draft: ["Draft brief", "Draf ringkasan", chipSmNeutral],
  ready: ["Ready", "Sedia", chipSmInfo],
  in_progress: ["In Progress", "Sedang Berjalan", chipSmInfo],
  waiting_client: ["Waiting for Client", "Menunggu Pelanggan", chipSmWarn],
  on_hold: ["On Hold", "Ditangguhkan", chipSmWarn],
  completed: ["Completed", "Selesai", chipSmSuccess],
  cancelled: ["Cancelled", "Dibatalkan", chipSmDanger],
};
export function ProjectStatusChip({ status }: { status: string }) {
  const s = PROJECT_STATUS[status] ?? [status, status, chipSmNeutral];
  return <span className={s[2]}>{L(s[0], s[1])}</span>;
}
const TASK_LABEL: Record<PTask["label"], [string, string, string]> = {
  completed: ["Completed", "Selesai", chipSmSuccess],
  in_progress: ["In Progress", "Sedang Berjalan", chipSmInfo],
  pending: ["Pending", "Menunggu", chipSmWarn],
  review: ["Ready for Review", "Sedia Disemak", chipSmWarn],
  not_started: ["Not Started", "Belum Bermula", chipSmNeutral],
  cancelled: ["Cancelled", "Dibatalkan", chipSmNeutral],
};
function TaskChip({ label }: { label: PTask["label"] }) {
  const s = TASK_LABEL[label];
  return <span className={s[2]}>{L(s[0], s[1])}</span>;
}
const QT_STATE: Record<string, [string, string, string]> = {
  accepted: ["Accepted", "Diterima", chipSmSuccess],
  invoiced: ["Invoiced", "Diinvois", chipSmSuccess],
  expired: ["Expired", "Tamat tempoh", chipSmDanger],
  open: ["Open", "Terbuka", chipSmNeutral],
};
export function QuotationStateChip({ label }: { label: string }) {
  const s = QT_STATE[label] ?? QT_STATE.open!;
  return <span className={s[2]}>{L(s[0], s[1])}</span>;
}
const UPDATE_KIND: Record<string, [string, string]> = {
  progress: ["Progress", "Kemajuan"], blocker: ["Blocker", "Halangan"], waiting_client: ["Waiting for client", "Menunggu pelanggan"],
  done_request: ["Says the project is done", "Kata projek sudah siap"], note: ["Note", "Nota"], correction: ["Correction", "Pembetulan"],
  assist_request: ["Asked to help", "Minta membantu"], review_request: ["Ready for review", "Sedia disemak"], review_approved: ["Approved", "Diluluskan"],
  review_returned: ["Returned", "Dikembalikan"], cancel: ["Cancelled", "Dibatalkan"],
};
const pctOf = (t: PTask) => (t.status === "completed" ? 100 : Math.max(0, Math.min(100, Number(t.progress) || 0)));

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className={pw.fact}><span className={pw.factLabel}>{label}</span><span className={pw.factValue}>{children}</span></div>;
}

/* ---------------- the workspace (picture 01: Project & Tasks) ---------------- */
type Sub = "tasks" | "updates" | "files" | "team" | "brief";
export function ProjectWorkspace({ projectId, onChanged, compactHead }: { projectId: number; onChanged?: () => void; compactHead?: ReactNode }) {
  const [w, setW] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [sub, setSub] = useState<Sub>("tasks");
  const [gantt, setGantt] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [settings, setSettings] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | { kind: "task" } | { kind: "edit" } | { kind: "owner" } | { kind: "status" } | { kind: "note"; assist: boolean } | { kind: "reassign"; task: PTask }>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void api<Workspace & { error?: { message?: string } }>(`/staff/projects/${projectId}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data) { setW(r.data); setError(""); } else setError(r.data?.error?.message ?? L("The project could not be loaded", "Projek tidak dapat dimuatkan"));
    });
    return () => c.abort();
  }, [projectId, tick]);
  const done = useCallback((title: string, sub2 = "") => { toast(title, sub2); setSheet(null); setTick((n) => n + 1); onChanged?.(); }, [toast, onChanged]);

  if (error) return <div className={card} role="alert"><p className={pw.empty}>{error}</p></div>;
  if (!w) return <div className={card} aria-busy="true"><Skel h="1.5rem" w="12rem" /><SkelRows rows={5} /></div>;
  const { project: p, can } = w;
  const doneCount = w.tasks.filter((t) => t.status === "completed").length;
  const subs: [Sub, string][] = [
    ["tasks", L(`Tasks (${w.tasks.length})`, `Tugasan (${w.tasks.length})`)],
    ["updates", L("Updates", "Kemas Kini")],
    ["files", L(`Files (${w.file_count})`, `Fail (${w.file_count})`)],
    ["team", L("Team", "Pasukan")],
    ["brief", L("Project Brief", "Ringkasan Projek")],
  ];
  const settingsOn = can.edit || can.assign_owner || w.transitions.length > 0;

  return (
    <div className={pw.wrap} data-testid="project-workspace">
      {toastNode}
      <section className={card} aria-label={L("Project & Tasks", "Projek & Tugasan")}>
        <div className={pw.wrap}>
          {/* the head: the project, where it came from, its state and progress */}
          <div className={pw.head}>
            <div className={pw.lead}>
              <span className={pw.well}><AppIcon name="assignment" /></span>
              <div>
                <h2 className={pw.title}>{L("Project", "Projek")}: {p.title}</h2>
                <p className={pw.sub}>{L(`From Quotation ${w.quotation.doc_number}`, `Daripada Sebut Harga ${w.quotation.doc_number}`)}</p>
              </div>
            </div>
            <div className={pw.cmds}>
              <ProjectStatusChip status={p.status} />
              <span className={pw.bar} aria-label={L(`Progress ${p.progress}%`, `Kemajuan ${p.progress}%`)}><span className={pw.track}><span className={p.progress >= 100 ? pw.fillDone : pw.fill} style={{ width: `${p.progress}%` }} /></span><span className={pw.pct}>{p.progress}%</span></span>
              {compactHead}
              {settingsOn && (
                <span className={pw.anchor}>
                  <button type="button" className={btnSm} aria-expanded={settings} onClick={() => setSettings((v) => !v)}><AppIcon name="fix" className="erp-icon" />{L("Project Settings", "Tetapan Projek")}</button>
                  {settings && (
                    <span className={pw.menu} role="menu" onMouseLeave={() => setSettings(false)}>
                      {can.edit && <button type="button" role="menuitem" onClick={() => { setSettings(false); setSheet({ kind: "edit" }); }}>{L("Edit project", "Sunting projek")}</button>}
                      {can.assign_owner && <button type="button" role="menuitem" onClick={() => { setSettings(false); setSheet({ kind: "owner" }); }}>{p.owner ? L("Change owner", "Tukar pemilik") : L("Assign owner", "Tetapkan pemilik")}</button>}
                      {w.transitions.length > 0 && <button type="button" role="menuitem" onClick={() => { setSettings(false); setSheet({ kind: "status" }); }}>{L("Project status…", "Status projek…")}</button>}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          {p.completion_requested_at && !["completed", "cancelled"].includes(p.status) && <p className={pw.warn}>{L(`Completion requested by ${p.completion_requested_by ?? "the owner"} on ${fmtDay(p.completion_requested_at)} — the CEO or COO confirms it.`, `Penyelesaian dipohon oleh ${p.completion_requested_by ?? "pemilik"} pada ${fmtDay(p.completion_requested_at)} — CEO atau COO mengesahkannya.`)}</p>}
          {p.cancelled_at && <p className={pw.warn}>{L(`Cancelled on ${fmtDay(p.cancelled_at)}: ${p.cancel_reason ?? ""}`, `Dibatalkan pada ${fmtDay(p.cancelled_at)}: ${p.cancel_reason ?? ""}`)}</p>}

          {/* the facts row */}
          <div className={pw.factsRow} aria-label={L("Client Information", "Maklumat Pelanggan")}>
            <Fact label={L("Client", "Pelanggan")}>
              {w.client?.company ?? "—"}
              {w.client?.contact_person && <span className={pw.factMuted}>{w.client.contact_person}</span>}
              {can.contact && (w.client?.phone || w.client?.email) && <span className={pw.factMuted}>{[w.client?.phone, w.client?.email].filter(Boolean).join(" · ")}</span>}
              {can.prices && w.client && <button type="button" className={pw.linkBtn} onClick={() => openCustomerFile(w.client!.id, w.client!.company)}>{L("View Client", "Lihat Pelanggan")}</button>}
            </Fact>
            <Fact label={L("Package", "Pakej")}>{w.package ? `${w.package.name}${w.package.customized ? L(" (customized)", " (diubah suai)") : ""}` : L("Custom service lines", "Baris perkhidmatan tersuai")}</Fact>
            <Fact label={L("Project Owner", "Pemilik Projek")}>
              {p.owner ? <span className={pw.person}><Avatar name={p.owner.name ?? ""} size="sm" /><span>{p.owner.name}</span></span> : <span className={pw.factMuted}>{L("Not assigned", "Belum ditetapkan")}{w.suggested_owner ? ` · ${L("suggested", "dicadangkan")}: ${w.suggested_owner.name}` : ""}</span>}
            </Fact>
            <Fact label={L("Start Date", "Tarikh Mula")}>{fmtDay(p.start_date)}</Fact>
            <Fact label={L("Due Date", "Tarikh Akhir")}>{fmtDay(p.due_date)}</Fact>
          </div>

          {/* the sub-tabs and Add Task */}
          <div className={pw.subRow}>
            <div className={pw.subTabs} role="tablist" aria-label={L("Project sections", "Bahagian projek")}>
              {subs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={sub === k} className={pw.subTab} onClick={() => setSub(k)}>{label}</button>)}
            </div>
            {can.add_task && <button type="button" className={btnSmPrimary} onClick={() => setSheet({ kind: "task" })}><AppIcon name="add" className="erp-icon" />{L("Add Task", "Tambah Tugasan")}</button>}
          </div>

          {/* TASKS: table on a desk, list on a phone, or the timeline (P-5) */}
          <div hidden={sub !== "tasks"} className={pw.wrap}>
            <div className={pw.cmds}>
              <span className={pw.factMuted}>{L(`${doneCount} of ${w.tasks.length} tasks completed`, `${doneCount} daripada ${w.tasks.length} tugasan selesai`)}</span>
              <button type="button" className={btnSm} aria-pressed={gantt} onClick={() => setGantt((g) => !g)}><AppIcon name={gantt ? "documents" : "chart"} className="erp-icon" />{gantt ? L("View List", "Lihat Senarai") : L("View Gantt", "Lihat Gantt")}</button>
            </div>
            {gantt ? <Gantt tasks={w.tasks} start={p.start_date} due={p.due_date} /> : (
              <>
                <div className={pw.table} role="table" aria-label={L("Project tasks", "Tugasan projek")}>
                  <div className={pw.thead} role="row">
                    <span role="columnheader">{L("Task", "Tugasan")}</span>
                    <span role="columnheader">{L("Assigned to", "Diberikan kepada")}</span>
                    <span role="columnheader">{L("Status", "Status")}</span>
                    <span role="columnheader">{L("Progress", "Kemajuan")}</span>
                    <span role="columnheader">{L("Due date", "Tarikh akhir")}</span>
                    <span role="columnheader">{L("Latest update", "Kemas kini terkini")}</span>
                    <span role="columnheader"><span className="erp-sr-only">{L("Actions", "Tindakan")}</span></span>
                  </div>
                  {w.tasks.length === 0 && <p className={pw.empty}>{can.add_task ? L("No tasks yet — Add Task assigns the first one.", "Belum ada tugasan — Tambah Tugasan untuk yang pertama.") : L("No tasks yet.", "Belum ada tugasan.")}</p>}
                  {w.tasks.map((t) => (
                    <div key={t.id} className={pw.trow} role="row" data-task={t.id}>
                      <span className={pw.taskCell} role="cell"><AppIcon name="success" className={t.status === "completed" ? pw.checkDone : pw.checkIcon} /><button type="button" className={pw.rowLink} onClick={() => setOpenTask(t.id)}>{t.title}</button></span>
                      <span className={pw.person} role="cell"><Avatar name={t.assignee} photoKey={t.photo_key} size="sm" /><span>{t.assignee}</span></span>
                      <span role="cell"><TaskChip label={t.label} /></span>
                      <span className={pw.bar} role="cell"><span className={pw.track} data-progress={pctOf(t)}><span className={pctOf(t) >= 100 ? pw.fillDone : pw.fill} style={{ width: `${pctOf(t)}%` }} /></span><span className={pw.pct}>{pctOf(t)}%</span></span>
                      <span role="cell">{fmtDay(t.deadline)}</span>
                      <span className={pw.when} role="cell">{t.last_update_at ? <><span className={pw.latestText}>{t.last_update}</span><span className={pw.whenBy}>{fmtStamp(t.last_update_at)}{t.last_update_by ? ` · ${t.last_update_by.split(" ")[0]}` : ""}</span></> : <span className={pw.whenBy}>{L("No progress report yet", "Belum ada laporan kemajuan")}</span>}</span>
                      <span className={pw.anchor} role="cell">
                        <button type="button" className={pw.more} aria-label={L(`Actions for ${t.title}`, `Tindakan untuk ${t.title}`)} aria-expanded={menu === t.id} onClick={() => setMenu(menu === t.id ? null : t.id)}>⋯</button>
                        {menu === t.id && (
                          <span className={pw.menu} role="menu" onMouseLeave={() => setMenu(null)}>
                            <button type="button" role="menuitem" onClick={() => { setMenu(null); setOpenTask(t.id); }}>{t.mine || can.update ? L("Open · add an update", "Buka · tambah kemas kini") : L("Open the task", "Buka tugasan")}</button>
                            {can.add_task && t.status !== "completed" && <button type="button" role="menuitem" onClick={() => { setMenu(null); setSheet({ kind: "reassign", task: t }); }}>{L("Reassign", "Agih semula")}</button>}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {/* picture 03: the phone's compact list - a tap opens the task */}
                <div className={pw.compact} aria-label={L("Project tasks", "Tugasan projek")}>
                  {w.tasks.length === 0 && <p className={pw.empty}>{L("No tasks yet.", "Belum ada tugasan.")}</p>}
                  {w.tasks.map((t) => (
                    <button key={t.id} type="button" className={pw.citem} onClick={() => setOpenTask(t.id)}
                      aria-label={`${t.title} · ${L(TASK_LABEL[t.label][0], TASK_LABEL[t.label][1])}`}>
                      <span className={pw.citemName}><span className={pw.citemIcon}><AppIcon name="document" /></span>{t.title}</span>
                      <TaskChip label={t.label} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* UPDATES: every task's progress and the project's own notes, one feed */}
          <div hidden={sub !== "updates"} className={pw.wrap}>
            {(can.manage || can.is_assigned) && OPEN_P.includes(p.status) && <span className={pw.cmds}><button type="button" className={btnSm} onClick={() => setSheet({ kind: "note", assist: false })}><AppIcon name="edit" className="erp-icon" />{L("Post a project note", "Hantar nota projek")}</button></span>}
            {can.assist && <span className={pw.cmds}><button type="button" className={btnSm} onClick={() => setSheet({ kind: "note", assist: true })}><AppIcon name="users" className="erp-icon" />{L("Offer to help", "Tawar membantu")}</button></span>}
            <Timeline items={w.updates.slice(0, 50).map((u) => ({ key: `u${u.id}`, at: u.created_at, by: u.author, photo_key: u.photo_key,
              text: `${L(UPDATE_KIND[u.kind]?.[0] ?? u.kind, UPDATE_KIND[u.kind]?.[1] ?? u.kind)}${u.task_title ? ` · ${u.task_title}` : ""}${u.progress_snapshot !== null && u.kind === "progress" ? ` · ${u.progress_snapshot}%` : ""}${u.corrects_id ? L(` (corrects #${u.corrects_id})`, ` (membetulkan #${u.corrects_id})`) : ""}`,
              quote: u.body }))} empty={L("No updates yet.", "Belum ada kemas kini.")} />
          </div>

          <div hidden={sub !== "files"}>{sub === "files" && <ProjectFiles projectId={p.id} />}</div>

          {/* TEAM: the Owner and everyone holding a task */}
          <div hidden={sub !== "team"}>
            <ul className={pw.list}>
              {p.owner && <li className={pw.person}><Avatar name={p.owner.name ?? ""} size="sm" /><span><strong>{p.owner.name}</strong> · {L("Project Owner", "Pemilik Projek")}</span></li>}
              {w.team.map((m) => <li key={m.id} className={pw.person}><Avatar name={m.name} photoKey={m.photo_key} size="sm" /><span>{m.name} · {L(`${w.tasks.filter((t) => t.assigned_to === m.id).length} task(s)`, `${w.tasks.filter((t) => t.assigned_to === m.id).length} tugasan`)}</span></li>)}
              {w.team.length === 0 && !p.owner && <li className={pw.empty}>{L("Nobody on the project yet.", "Belum ada sesiapa dalam projek.")}</li>}
            </ul>
          </div>

          {/* PROJECT BRIEF: the description, deliverables and the agreed scope */}
          <div hidden={sub !== "brief"}>
            <section className={pw.panel} aria-label={L("Brief and scope", "Ringkasan dan skop")}>
              {p.description && <p className={pw.prose}>{p.description}</p>}
              {p.deliverables.length > 0 && <><span className={pw.factLabel}>{L("Deliverables", "Hasil")}</span><ul className={pw.bullet}>{p.deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
              <span className={pw.factLabel}>{w.scope.frozen ? L(`Agreed scope (quotation revision ${w.scope.revision}, frozen at start)`, `Skop dipersetujui (semakan ${w.scope.revision}, dibekukan semasa mula)`) : L("Scope (from the quotation; frozen when the project starts)", "Skop (daripada sebut harga; dibekukan apabila projek bermula)")}</span>
              <ul className={pw.list}>
                {w.scope.lines.map((l, i) => (
                  <li key={i}>
                    <div className={pw.scopeLine}><span>{l.name} · {l.qty}{l.uom ? ` ${l.uom}` : ""}</span>{can.prices && l.line_cents !== undefined && <span>{rmc(l.line_cents)}</span>}</div>
                    {l.sub.length > 0 && <p className={pw.scopeSub}>{l.sub.join(" · ")}</p>}
                  </li>
                ))}
              </ul>
              {can.prices && w.scope.totals && <div className={pw.scopeLine}><strong>{L("Total", "Jumlah")}</strong><strong>{rmc(w.scope.totals.total_cents)}</strong></div>}
              {w.scope.revised_after_activation && <p className={pw.warn}>{L("The quotation was revised after the project started — the agreed scope above is unchanged.", "Sebut harga disemak selepas projek bermula — skop dipersetujui di atas tidak berubah.")}</p>}
              {p.notes && <><span className={pw.factLabel}>{L("Internal notes (owner and management)", "Nota dalaman (pemilik dan pengurusan)")}</span><p className={pw.prose}>{p.notes}</p></>}
            </section>
          </div>
        </div>
      </section>

      {openTask !== null && <TaskDrawer taskId={openTask} onClose={() => { setOpenTask(null); setTick((n) => n + 1); }} onChanged={() => onChanged?.()} />}
      {sheet?.kind === "note" && <NoteSheet w={w} assist={sheet.assist} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "task" && <TaskSheet w={w} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "reassign" && <TaskSheet w={w} task={sheet.task} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "edit" && <EditSheet w={w} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "owner" && <OwnerSheet w={w} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "status" && <StatusSheet w={w} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}
const OPEN_P = ["draft", "ready", "in_progress", "waiting_client", "on_hold"];

/* ---------------- the timeline (picture 3, part 6) ---------------- */
export type TItem = { key: string; at: string; by: string | null; photo_key?: string | null; text: string; quote?: string | null };
function Timeline({ items, empty }: { items: TItem[]; empty: string }) {
  if (!items.length) return <p className={pw.empty}>{empty}</p>;
  return (
    <ol className={pw.timeline}>
      {items.map((e) => (
        <li key={e.key} className={pw.tItem}>
          <span className={pw.tWhen}>{fmtStamp(e.at)}</span>
          {e.by && <span className={pw.tWho}><Avatar name={e.by} photoKey={e.photo_key} size="sm" />{e.by}</span>}
          <span className={pw.tWhat}>{e.text}</span>
          {e.quote && <p className={pw.tQuote}>“{e.quote}”</p>}
        </li>
      ))}
    </ol>
  );
}
export function ProjectActivity({ projectId, extra = [] }: { projectId: number | null; extra?: TItem[] }) {
  const [items, setItems] = useState<TItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!projectId) { void Promise.resolve().then(() => { if (alive) setItems([]); }); return () => { alive = false; }; }
    void api<{ activity: { key: string; at: string; by: string | null; photo_key: string | null; text: string; quote: string | null }[] }>(`/staff/projects/${projectId}/activity`).then((r) => { if (alive) setItems(r.data?.activity ?? []); });
    return () => { alive = false; };
  }, [projectId]);
  if (items === null) return <SkelRows rows={4} />;
  const all = [...items, ...extra].sort((a, b) => b.at.localeCompare(a.at));
  return <section className={pw.panel} aria-label={L("Project Activity", "Aktiviti Projek")} data-testid="project-activity"><h3 className={pw.panelTitle}>{L("Project Activity", "Aktiviti Projek")}</h3><Timeline items={all} empty={L("Nothing has happened yet.", "Belum ada aktiviti.")} /></section>;
}

/* ---------------- Gantt (P-5): bars by start and due date ---------------- */
function Gantt({ tasks, start, due }: { tasks: PTask[]; start: string | null; due: string | null }) {
  const [nowMs] = useState(() => Date.now());
  const day = (v: string) => Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  const rows = tasks.map((t) => {
    const s = day(start && start > t.created_at.slice(0, 10) ? start : t.created_at.slice(0, 10));
    const e = t.deadline ? day(t.deadline) : due ? day(due) : s + 86400000;
    return { t, s, e: Math.max(e, s + 86400000) };
  });
  const today = nowMs + 8 * 3600 * 1000;
  const lo = Math.min(...rows.map((r) => r.s), start ? day(start) : Infinity, today);
  const hi = Math.max(...rows.map((r) => r.e), due ? day(due) : -Infinity, today + 86400000);
  const span = Math.max(hi - lo, 86400000);
  const pos = (v: number) => `${((v - lo) / span) * 100}%`;
  if (!tasks.length) return <div className={pw.gantt}><p className={pw.empty}>{L("No tasks to draw yet.", "Belum ada tugasan untuk dilukis.")}</p></div>;
  const cls = (l: PTask["label"]) => `${pw.gBar} ${l === "completed" ? pw.gBarDone : l === "pending" ? pw.gBarPending : l === "not_started" ? pw.gBarIdle : ""}`;
  return (
    <div className={pw.gantt} role="figure" aria-label={L("Project timeline: task bars from start to due date", "Garis masa projek: bar tugasan dari mula hingga tarikh akhir")} data-testid="project-gantt">
      <div className={pw.gScale}><span>{fmtDay(new Date(lo).toISOString())}</span><span>{fmtDay(new Date(hi).toISOString())}</span></div>
      {rows.map(({ t, s, e }) => (
        <div key={t.id} className={pw.gRow} data-gantt-row={t.id}>
          <span className={pw.gName}>{t.title}<span className={pw.factMuted} style={{ display: "block", fontWeight: 400 }}>{t.assignee} · {fmtDay(t.deadline)}</span></span>
          <span className={pw.gLane}>
            <span className={cls(t.label)} style={{ left: pos(s), width: `calc(${pos(e)} - ${pos(s)})` }} title={`${t.title}: ${fmtDay(new Date(s).toISOString())} – ${fmtDay(new Date(e).toISOString())}`} />
            {today >= lo && today <= hi && <span className={pw.gToday} style={{ left: pos(today) }} aria-hidden="true" />}
          </span>
        </div>
      ))}
      <div className={pw.gLegend}>
        <span><span className={`${pw.dot} ${pw.gBarDone}`} />{L("Completed", "Selesai")}</span>
        <span><span className={pw.dot} style={{ background: "var(--info)" }} />{L("In progress", "Sedang berjalan")}</span>
        <span><span className={`${pw.dot} ${pw.gBarPending}`} />{L("Pending", "Menunggu")}</span>
        <span><span className={`${pw.dot} ${pw.gBarIdle}`} />{L("Not started", "Belum bermula")}</span>
        <span><span className={pw.dot} style={{ background: "var(--danger)" }} />{L("Today", "Hari ini")}</span>
      </div>
    </div>
  );
}

/* ---------------- the sheets ---------------- */
type Done = (title: string, sub?: string) => void;
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } finally { setBusy(false); } };
  return { busy, run };
}
function Problem({ text }: { text: string }) { return text ? <p className={pw.warn} role="alert">{text}</p> : null; }

/** A project-level note (no task), or an offer to help. A task's own update
    is posted from the task (task-progress.tsx). */
/* v1.246.3 - THE CUSTOMER AGREED (the owner, 01-11-2026: "there should be
   a button first for acceptance Quotation before Start Project"). The
   salesperson records who said yes and how; the row lands in the same
   acceptance record the shared link writes, once per revision. */
export function AcceptanceSheet({ quotationId, docNumber, company, contact, onClose, onDone }: {
  quotationId: number; docNumber: string; company: string; contact?: string | null; onClose: () => void; onDone: (title: string, text: string) => void;
}) {
  const [f, setF] = useState({ accepted_name: contact ?? "", accepted_position: "", channel: "whatsapp", note: "" });
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const submit = () => run(async () => {
    setProblem("");
    if (f.accepted_name.trim().length < 2) { setProblem(L("Name the person who agreed on the customer's side.", "Namakan orang yang bersetuju di pihak pelanggan.")); return; }
    const r = await api<{ error?: { message?: string } }>(`/staff/docs/${quotationId}/acceptance`, { method: "POST", body: JSON.stringify({ ...f, accepted_name: f.accepted_name.trim(), accepted_position: f.accepted_position.trim() || undefined, note: f.note.trim() || undefined }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not recorded - check the connection and try again.", "Tidak direkodkan - semak sambungan dan cuba lagi.")); return; }
    onDone(L("Acceptance recorded", "Penerimaan direkodkan"), L(`${docNumber} is accepted by ${company}. The project can start now.`, `${docNumber} diterima oleh ${company}. Projek boleh bermula sekarang.`));
  });
  return (
    <SideDrawer open onClose={onClose} title={L("Record the customer's acceptance", "Rekod penerimaan pelanggan")} subtitle={`${docNumber} · ${company}`}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()} data-testid="record-acceptance">{busy ? L("Recording…", "Merekod…") : L("Record acceptance", "Rekod penerimaan")}</button>}>
      <div className={pw.form} data-testid="acceptance-sheet">
        <p className={pw.note}>{L("Use this when the customer has agreed to proceed outside the shared link - on WhatsApp, by email or phone, on a signed order, or in person. It is kept against this revision of the quotation, with your name and the time.", "Guna ini apabila pelanggan bersetuju meneruskan di luar pautan kongsi - di WhatsApp, melalui e-mel atau telefon, pada pesanan bertandatangan, atau secara bersemuka. Ia disimpan terhadap semakan sebut harga ini, dengan nama anda dan masa.")}</p>
        <label className={fieldLabel}>{L("Who agreed (customer side)", "Siapa yang bersetuju (pihak pelanggan)")}
          <input className={inputClass} value={f.accepted_name} maxLength={120} onChange={(e) => setF({ ...f, accepted_name: e.target.value })} />
        </label>
        <label className={fieldLabel}>{L("Their position (optional)", "Jawatan mereka (pilihan)")}
          <input className={inputClass} value={f.accepted_position} maxLength={120} onChange={(e) => setF({ ...f, accepted_position: e.target.value })} />
        </label>
        <label className={fieldLabel}>{L("How they agreed", "Cara mereka bersetuju")}
          <select className={selectClass} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">{L("Email", "E-mel")}</option>
            <option value="phone">{L("Phone call", "Panggilan telefon")}</option>
            <option value="signed">{L("Signed quotation / purchase order", "Sebut harga / pesanan belian bertandatangan")}</option>
            <option value="in_person">{L("In person", "Bersemuka")}</option>
          </select>
        </label>
        <label className={fieldLabel}>{L("Reference or note (optional)", "Rujukan atau nota (pilihan)")}
          <textarea className={textareaClass} rows={3} maxLength={500} value={f.note} placeholder={L("e.g. PO number, the date of the message", "cth. nombor PO, tarikh mesej")} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

function NoteSheet({ w, assist, onClose, onDone }: { w: Workspace; assist: boolean; onClose: () => void; onDone: Done }) {
  const [kind, setKind] = useState<"note" | "done_request">("note");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const submit = () => run(async () => {
    setProblem("");
    if (!text.trim()) { setProblem(L("Write it first.", "Tulis dahulu.")); return; }
    const r = await api<{ error?: { message?: string } }>(`/staff/projects/${w.project.id}/updates`, { method: "POST", body: JSON.stringify({ kind: assist ? "assist_request" : kind, body: text.trim() }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent - check the connection and try again.", "Tidak dihantar - semak sambungan dan cuba lagi.")); return; }
    onDone(assist ? L("Offer sent", "Tawaran dihantar") : L("Note posted", "Nota dihantar"), assist ? L("The Project Owner has been told you can help.", "Pemilik Projek telah dimaklumkan anda boleh membantu.") : L("It stays on the project's record with your name and the time.", "Ia kekal dalam rekod projek dengan nama anda dan masa."));
  });
  return (
    <SideDrawer open onClose={onClose} title={assist ? L("Offer to help", "Tawar membantu") : L("Project note", "Nota projek")}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Sending…", "Menghantar…") : assist ? L("Send", "Hantar") : L("Post note", "Hantar nota")}</button>}>
      <div className={pw.form}>
        {!assist && (
          <label className={fieldLabel}>{L("Kind", "Jenis")}
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as "note" | "done_request")}>
              <option value="note">{L("A note for the team", "Nota untuk pasukan")}</option>
              <option value="done_request">{L("The whole project is done - ask the CEO/COO to confirm", "Seluruh projek siap - minta CEO/COO mengesahkan")}</option>
            </select>
          </label>
        )}
        <label className={fieldLabel}>{assist ? L("How you can help", "Bagaimana anda boleh membantu") : L("Note", "Nota")}
          <textarea className={textareaClass} rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <span className={pw.counter}>{text.length}/500</span>
        <p className={pw.note}>{L("Progress on a task is posted from the task itself (open it from the Tasks list).", "Kemajuan tugasan dihantar dari tugasan itu sendiri (buka dari senarai Tugasan).")}</p>
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

/** Add Task (one task engine) or reassign one. */
function TaskSheet({ w, task, onClose, onDone }: { w: Workspace; task?: PTask; onClose: () => void; onDone: Done }) {
  const staff = useStaff();
  const suggestions = useMemo(() => [...new Set([...w.project.deliverables, ...w.scope.lines.map((l) => l.name)])].filter((s) => !w.tasks.some((t) => t.title === s)), [w]);
  const [f, setF] = useState({ title: task?.title ?? "", description: "", assigned_to: task?.assigned_to ?? 0, deadline: "", priority: "normal", reason: "" });
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const submit = () => run(async () => {
    setProblem("");
    if (task) {
      if (!f.assigned_to || f.assigned_to === task.assigned_to) { setProblem(L("Choose somebody else.", "Pilih orang lain.")); return; }
      const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ assigned_to: f.assigned_to, reason: f.reason }) });
      if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not reassigned", "Tidak diagih semula")); return; }
      onDone(L("Reassigned", "Diagih semula"), L("The new assignee is told.", "Penerima baharu dimaklumkan."));
      return;
    }
    if (!f.title.trim() || !f.assigned_to) { setProblem(L("A title and a person are needed.", "Tajuk dan orang diperlukan.")); return; }
    const r = await api<{ id?: number; error?: { message?: string } }>("/staff/tasks", { method: "POST", body: JSON.stringify({
      title: f.title.trim(), description: f.description.trim() || undefined, assigned_to: f.assigned_to, deadline: f.deadline || undefined, priority: f.priority,
      link_kind: "project", link_id: w.project.id,
    }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not added", "Tidak ditambah")); return; }
    onDone(L("Task added", "Tugasan ditambah"), L("The assignee is told.", "Penerima dimaklumkan."));
  });
  return (
    <SideDrawer open onClose={onClose} title={task ? L(`Reassign: ${task.title}`, `Agih semula: ${task.title}`) : L("Add Task", "Tambah Tugasan")}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Saving…", "Menyimpan…") : task ? L("Reassign", "Agih semula") : L("Add Task", "Tambah Tugasan")}</button>}>
      <div className={pw.form}>
        {!task && <>
          <label className={fieldLabel}>{L("Task title", "Tajuk tugasan")}<input className={inputClass} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} list="project-task-suggestions" /></label>
          <datalist id="project-task-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          {suggestions.length > 0 && <p className={pw.note}>{L("Suggestions come from the deliverables and the quotation lines — nothing is created until you press Add Task.", "Cadangan daripada hasil dan baris sebut harga — tiada yang dicipta sehingga anda tekan Tambah Tugasan.")}</p>}
          <label className={fieldLabel}>{L("Description", "Penerangan")}<textarea className={textareaClass} rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        </>}
        {staff === null ? <Skel h="2.75rem" /> : <label className={fieldLabel}>{L("Assigned to", "Diberikan kepada")}
          <select className={selectClass} value={f.assigned_to || ""} onChange={(e) => setF({ ...f, assigned_to: Number(e.target.value) || 0 })}>
            <option value="">{L("Choose a staff member", "Pilih kakitangan")}</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.position ? ` · ${s.position}` : ""}</option>)}
          </select>
        </label>}
        {task && <label className={fieldLabel}>{L("Reason (required)", "Sebab (wajib)")}<textarea className={textareaClass} rows={2} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>}
        {!task && <>
          <label className={fieldLabel}>{L("Due date", "Tarikh akhir")}<input className={inputClass} type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></label>
          <label className={fieldLabel}>{L("Priority", "Keutamaan")}
            <select className={selectClass} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="low">{L("Low", "Rendah")}</option><option value="normal">{L("Normal", "Biasa")}</option><option value="high">{L("High", "Tinggi")}</option><option value="urgent">{L("Urgent", "Segera")}</option>
            </select>
          </label>
        </>}
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

function EditSheet({ w, onClose, onDone }: { w: Workspace; onClose: () => void; onDone: Done }) {
  const p = w.project;
  const [f, setF] = useState({ title: p.title, description: p.description ?? "", start_date: p.start_date ?? "", due_date: p.due_date ?? "", notes: p.notes ?? "", deliverables: p.deliverables.join("\n") });
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const submit = () => run(async () => {
    setProblem("");
    const r = await api<{ error?: { message?: string } }>(`/staff/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({
      title: f.title, description: f.description, start_date: f.start_date, due_date: f.due_date, notes: f.notes,
      deliverables: f.deliverables.split("\n").map((s) => s.trim()).filter(Boolean), version: p.version,
    }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onDone(L("Project saved", "Projek disimpan"));
  });
  return (
    <SideDrawer open onClose={onClose} title={L("Edit Project", "Sunting Projek")} subtitle={L("Client, quotation and package details stay in Sales.", "Butiran pelanggan, sebut harga dan pakej kekal di Jualan.")}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}</button>}>
      <div className={pw.form}>
        <label className={fieldLabel}>{L("Project title", "Tajuk projek")}<input className={inputClass} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className={fieldLabel}>{L("Description", "Penerangan")}<textarea className={textareaClass} rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className={fieldLabel}>{L("Start date", "Tarikh mula")}<input className={inputClass} type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
        <label className={fieldLabel}>{L("Due date", "Tarikh akhir")}<input className={inputClass} type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
        <label className={fieldLabel}>{L("Deliverables (one per line)", "Hasil (satu setiap baris)")}<textarea className={textareaClass} rows={4} value={f.deliverables} onChange={(e) => setF({ ...f, deliverables: e.target.value })} /></label>
        <label className={fieldLabel}>{L("Implementation notes (owner and management only)", "Nota pelaksanaan (pemilik dan pengurusan sahaja)")}<textarea className={textareaClass} rows={3} maxLength={4000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

function OwnerSheet({ w, onClose, onDone }: { w: Workspace; onClose: () => void; onDone: Done }) {
  const staff = useStaff();
  const [owner, setOwner] = useState<number>(w.project.owner?.id ?? w.suggested_owner?.id ?? 0);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const transfer = !!w.project.owner;
  const submit = () => run(async () => {
    setProblem("");
    if (!owner) { setProblem(L("Choose the Project Owner.", "Pilih Pemilik Projek.")); return; }
    const r = await api<{ error?: { message?: string } }>(`/staff/projects/${w.project.id}/owner`, { method: "POST", body: JSON.stringify({ owner_id: owner, reason }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onDone(L("Project Owner set", "Pemilik Projek ditetapkan"), L("The closer and commission are unchanged.", "Penutup jualan dan komisen tidak berubah."));
  });
  return (
    <SideDrawer open onClose={onClose} title={transfer ? L("Transfer the project", "Pindah projek") : L("Assign the Project Owner", "Tetapkan Pemilik Projek")}
      subtitle={L("The person who acquired the client. Nothing records that today, so it is confirmed here — it never changes the closer or commission.", "Orang yang memperoleh pelanggan. Tiada rekod mengenainya, jadi ia disahkan di sini — tidak menukar penutup jualan atau komisen.")}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Saving…", "Menyimpan…") : L("Confirm owner", "Sahkan pemilik")}</button>}>
      <div className={pw.form}>
        {w.suggested_owner && !transfer && <p className={pw.note}>{L(`Suggested from the quotation's salesperson: ${w.suggested_owner.name} — not confirmed.`, `Dicadangkan daripada jurujual sebut harga: ${w.suggested_owner.name} — belum disahkan.`)}</p>}
        {staff === null ? <Skel h="2.75rem" /> : <label className={fieldLabel}>{L("Project Owner", "Pemilik Projek")}
          <select className={selectClass} value={owner || ""} onChange={(e) => setOwner(Number(e.target.value) || 0)}>
            <option value="">{L("Choose a staff member", "Pilih kakitangan")}</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.position ? ` · ${s.position}` : ""}</option>)}
          </select>
        </label>}
        <label className={fieldLabel}>{transfer ? L("Reason (required for a transfer)", "Sebab (wajib untuk pemindahan)") : L("Note (optional)", "Nota (pilihan)")}<textarea className={textareaClass} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

function StatusSheet({ w, onClose, onDone }: { w: Workspace; onClose: () => void; onDone: Done }) {
  const [to, setTo] = useState(w.transitions.find((t) => !t.blocked)?.to ?? "");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const t = w.transitions.find((x) => x.to === to);
  const submit = () => run(async () => {
    setProblem("");
    if (!t || t.blocked) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/projects/${w.project.id}/status`, { method: "POST", body: JSON.stringify({ to, reason }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not changed", "Tidak ditukar")); return; }
    onDone(L("Status changed", "Status ditukar"));
  });
  return (
    <SideDrawer open onClose={onClose} title={L("Project status", "Status projek")} subtitle={L("Starting the project freezes the agreed scope from the quotation.", "Memulakan projek membekukan skop dipersetujui daripada sebut harga.")}
      footer={<button type="button" className={`${btnClass} ${pw.submit}`} disabled={busy || !t || !!t.blocked} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Saving…", "Menyimpan…") : L("Change status", "Tukar status")}</button>}>
      <div className={pw.form}>
        <fieldset className={pw.form} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={pw.factLabel}>{L("Move the project to", "Pindahkan projek ke")}</legend>
          {w.transitions.map((x) => (
            <label key={x.to} className={pw.fileRow}>
              <span><input type="radio" name="project-status" value={x.to} checked={to === x.to} onChange={() => setTo(x.to)} disabled={!!x.blocked} /> <ProjectStatusChip status={x.to} /> {x.label}</span>
              {x.blocked && <span className={pw.factMuted}>{x.blocked}</span>}
            </label>
          ))}
        </fieldset>
        {t?.needs_reason && <label className={fieldLabel}>{L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)")}<textarea className={textareaClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}

/* ---------------- files ---------------- */
export function ProjectFiles({ projectId }: { projectId: number }) {
  type PFile = { id: number; task_id: number | null; task_title: string | null; file_name: string; size_bytes: number | null; level: string; created_at: string; uploader: string; open: boolean };
  const [files, setFiles] = useState<PFile[] | null>(null);
  const [can, setCan] = useState<Workspace["can"] | null>(null);
  const [level, setLevel] = useState<"team" | "restricted">("team");
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    /* v1.246.0 - one list: the files of every task on the project and the
       project's own (task_files) */
    void Promise.all([api<{ files: PFile[] }>(`/staff/projects/${projectId}/files`), api<Workspace>(`/staff/projects/${projectId}`)]).then(([f, ws]) => {
      if (!alive) return;
      setFiles(f.data?.files ?? []);
      setCan(ws.data?.can ?? null);
    });
    return () => { alive = false; };
  }, [projectId, tick]);
  const upload = async (file: File) => {
    setMsg("");
    const r = await csrfFetch(`/api/v1/staff/projects/${projectId}/files`, { method: "POST", body: file,
      headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name, "X-File-Level": level } });
    if (!r.ok) { const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null; setMsg(j?.error?.message ?? L("Not uploaded", "Tidak dimuat naik")); return; }
    setTick((n) => n + 1);
  };
  return (
    <section className={pw.panel} aria-label={L("Project files", "Fail projek")} data-testid="project-files">
      <h3 className={pw.panelTitle}>{L("Project files", "Fail projek")}</h3>
      {files === null ? <SkelRows rows={3} /> : files.length === 0 ? <p className={pw.empty}>{L("No files yet.", "Belum ada fail.")}</p> : (
        <div>
          {files.map((f) => (
            <div key={f.id} className={pw.fileRow}>
              <span className={pw.fileName}><AppIcon name={f.open ? "document" : "lock"} className="erp-icon" />
                {f.open ? <a className={pw.linkBtn} href={`/api/v1/staff/projects/${projectId}/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.file_name}</a> : <span>{f.file_name} · {L("restricted", "terhad")}</span>}
              </span>
              <span className={pw.factMuted}>{f.task_title ? `${f.task_title} · ` : ""}{f.uploader} · {fmtDay(f.created_at)}{f.level === "restricted" ? ` · ${L("restricted", "terhad")}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {can?.files && (
        <div className={pw.form}>
          {can.restricted_files && (
            <label className={fieldLabel}>{L("Who may open it", "Siapa boleh membukanya")}
              <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as "team" | "restricted")}>
                <option value="team">{L("All staff who can see the project", "Semua kakitangan yang boleh melihat projek")}</option>
                <option value="restricted">{L("Restricted: owner and management", "Terhad: pemilik dan pengurusan")}</option>
              </select>
            </label>
          )}
          <label className={pw.file}><AppIcon name="upload" className="erp-icon" />{L("Add a project file (PDF, image, Word)", "Tambah fail projek (PDF, imej, Word)")}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
          <p className={pw.note}>{L("A file about one task is added from that task.", "Fail mengenai satu tugasan ditambah dari tugasan itu.")}</p>
          <Problem text={msg} />
        </div>
      )}
    </section>
  );
}

/* ---------------- Tasks > Projects ---------------- */
type PRow = { id: number; quotation_id: number; title: string; status: string; due_date: string | null; owner_id: number | null; owner_name: string | null; doc_number: string; company: string; tasks: number; done: number; progress: number; my_open: number };
export function ProjectsBoard({ openId, onOpen }: { openId?: number | null; onOpen?: (id: number | null) => void }) {
  const [scope, setScope] = useState<"assigned" | "mine" | "all">("assigned");
  const [rows, setRows] = useState<PRow[] | null>(null);
  const [picked, setOpen] = useState<number | null>(null);
  const open = picked ?? openId ?? null;
  const [tick, setTick] = useState(0);
  /* v1.246.2 - the quotations with no project yet (mine, or every live one
     for the CEO, COO and CCO): a project starts from here too, not only from
     the quotation page in Sales */
  const [unstarted, setUnstarted] = useState<{ id: number; doc_number: string; company: string; contact_person: string | null; label: string; can_start: boolean }[]>([]);
  const [accepting, setAccepting] = useState<{ id: number; doc_number: string; company: string; contact_person: string | null } | null>(null);
  const { show: showToast, node: toastNode } = useSaveToast();
  const [starting, setStarting] = useState<number | null>(null);
  const [startErr, setStartErr] = useState("");
  useEffect(() => {
    let alive = true;
    void api<{ projects: PRow[] }>(`/staff/projects?scope=${scope}`).then((r) => { if (alive) setRows(r.data?.projects ?? []); });
    void api<{ quotations: { id: number; doc_number: string; company: string; contact_person: string | null; label: string; can_start: boolean; project_id: number | null }[] }>(`/staff/projects/quotations`)
      .then((r) => { if (alive) setUnstarted((r.data?.quotations ?? []).filter((q) => !q.project_id)); });
    return () => { alive = false; };
  }, [scope, tick]);
  const choose = (id: number | null) => { setOpen(id); onOpen?.(id); };
  const start = async (qid: number) => {
    setStarting(qid); setStartErr("");
    const r = await api<{ id?: number; error?: { message?: string } }>("/staff/projects", { method: "POST", body: JSON.stringify({ quotation_id: qid }) });
    setStarting(null);
    if (!r.ok || !r.data?.id) { setStartErr(r.data?.error?.message ?? L("Not started", "Tidak dimulakan")); return; }
    setTick((n) => n + 1);
    choose(r.data.id);
  };
  if (open) {
    return (
      <div className={pw.wrap}>
        <button type="button" className={pw.back} onClick={() => choose(null)}><AppIcon name="previous" className="erp-icon" />{L("All projects", "Semua projek")}</button>
        <ProjectWorkspace projectId={open} onChanged={() => setTick((n) => n + 1)} />
        <ProjectActivity projectId={open} />
        <ProjectFiles projectId={open} />
      </div>
    );
  }
  return (
    <section className={card} aria-label={L("Projects", "Projek")} data-testid="projects-board">
      {toastNode}
      {accepting && <AcceptanceSheet quotationId={accepting.id} docNumber={accepting.doc_number} company={accepting.company} contact={accepting.contact_person} onClose={() => setAccepting(null)}
        onDone={(t, x) => { setAccepting(null); showToast(t, x); setTick((n) => n + 1); }} />}
      <div className={pw.wrap}>
        <div className={pw.head}>
          <div className={pw.lead}>
            <span className={pw.well}><AppIcon name="folder" /></span>
            <div><h2 className={pw.title}>{L("Projects", "Projek")}</h2><p className={pw.sub}>{L("Delivery work from accepted quotations. Open one to see its tasks, updates and files.", "Kerja penghantaran daripada sebut harga yang diterima. Buka satu untuk melihat tugasan, kemas kini dan failnya.")}</p></div>
          </div>
          <div className={pw.cmds} role="group" aria-label={L("Which projects", "Projek mana")}>
            {([["assigned", L("I'm on", "Saya terlibat")], ["mine", L("I own", "Milik saya")], ["all", L("All", "Semua")]] as const).map(([k, label]) => (
              <button key={k} type="button" className={scope === k ? btnSmPrimary : btnSm} aria-pressed={scope === k} onClick={() => setScope(k)}>{label}</button>
            ))}
          </div>
        </div>
        {rows === null ? <SkelRows rows={4} /> : rows.length === 0 ? <p className={pw.empty}>{scope === "all" ? L("No projects yet. Start one from a quotation below, or set a task under a quotation in Create Task.", "Belum ada projek. Mulakan daripada sebut harga di bawah, atau tetapkan tugasan di bawah sebut harga dalam Buat Tugasan.") : L("Nothing here — try All.", "Tiada di sini — cuba Semua.")}</p> : (
          <div className={pw.plist}>
            {rows.map((r) => (
              <button key={r.id} type="button" className={pw.pitem} onClick={() => choose(r.id)} data-project={r.id}>
                <span><p className={pw.pTitle}>{r.title}</p><p className={pw.pSub}>{r.doc_number} · {r.company}</p></span>
                <span className={pw.pHide}><p className={pw.pSub}>{L("Owner", "Pemilik")}</p><p className={pw.pTitle} style={{ fontWeight: 600 }}>{r.owner_name ?? L("Not assigned", "Belum ditetapkan")}</p></span>
                <span className={pw.pHide}><p className={pw.pSub}>{L("Due", "Akhir")} {fmtDay(r.due_date)}</p><span className={pw.bar}><span className={pw.track}><span className={r.progress >= 100 ? pw.fillDone : pw.fill} style={{ width: `${r.progress}%` }} /></span><span className={pw.pct}>{r.progress}%</span></span></span>
                <span><ProjectStatusChip status={r.status} />{r.my_open > 0 && <span className={chipSmInfo} style={{ marginLeft: "0.375rem" }}>{L(`${r.my_open} mine`, `${r.my_open} saya`)}</span>}</span>
              </button>
            ))}
          </div>
        )}
        {unstarted.length > 0 && (
          <div className={pw.unstarted} data-testid="unstarted-quotations">
            <p className={pw.pSub}>{L(`Quotations without a project (${unstarted.length})`, `Sebut harga tanpa projek (${unstarted.length})`)}</p>
            <p className={pw.note}>{L("A project starts once the customer has agreed to proceed: accepted on the shared link, recorded here, or invoiced.", "Projek bermula apabila pelanggan bersetuju meneruskan: diterima melalui pautan kongsi, direkodkan di sini, atau telah diinvois.")}</p>
            {startErr && <p className={pw.problem} role="alert">{startErr}</p>}
            <div className={pw.plist}>
              {unstarted.map((q) => (
                <div key={q.id} className={pw.pitem} data-quotation={q.id}>
                  <span><p className={pw.pTitle}>{q.doc_number}</p><p className={pw.pSub}>{q.company} · {q.label === "accepted" ? L("accepted", "diterima") : q.label === "invoiced" ? L("invoiced", "diinvois") : q.label === "expired" ? L("expired", "tamat tempoh") : L("awaiting the customer", "menunggu pelanggan")}</p></span>
                  <span />
                  <span />
                  <span>{q.can_start
                    ? <button type="button" className={btnSmPrimary} disabled={starting === q.id} onClick={() => void start(q.id)}><AppIcon name="add" />{starting === q.id ? L("Starting…", "Memulakan…") : L("Start project", "Mulakan projek")}</button>
                    : q.label === "expired"
                      ? <span className={chipSmNeutral}>{L("Revise first", "Semak semula dahulu")}</span>
                      : <button type="button" className={btnSm} onClick={() => setAccepting(q)}><AppIcon name="verify" />{L("Record acceptance", "Rekod penerimaan")}</button>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The quotation page's Project Task tab when no brief exists yet (P-1). */
export function CreateBrief({ quotationId, docNumber, company, contact, onCreated }: { quotationId: number; docNumber?: string; company?: string; contact?: string | null; onCreated: (id: number) => void }) {
  const [state, setState] = useState<{ can_create: boolean; can_record_acceptance?: boolean; quotation_state?: { label: string }; suggested_owner: { name: string | null } | null } | null>(null);
  const [problem, setProblem] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [tick, setTick] = useState(0);
  const { show: showToast, node: toastNode } = useSaveToast();
  const { busy, run } = useBusy();
  useEffect(() => { void api<{ can_create: boolean; can_record_acceptance?: boolean; quotation_state?: { label: string }; suggested_owner: { name: string | null } | null }>(`/staff/projects/by-quotation/${quotationId}`).then((r) => setState(r.data ?? null)); }, [quotationId, tick]);
  if (!state) return <SkelRows rows={2} />;
  const create = () => run(async () => {
    setProblem("");
    const r = await api<{ id?: number; error?: { message?: string } }>("/staff/projects", { method: "POST", body: JSON.stringify({ quotation_id: quotationId }) });
    if (!r.ok || !r.data?.id) { setProblem(r.data?.error?.message ?? L("Not created", "Tidak dicipta")); return; }
    onCreated(r.data.id);
  });
  return (
    <div className={pw.cta} data-testid="create-brief">
      <span className={pw.well}><AppIcon name="assignment" /></span>
      <h3 className={pw.title}>{L("No project brief yet", "Belum ada ringkasan projek")}</h3>
      <p className={pw.sub}>{L("A project brief turns this quotation into delivery work: tasks for the team, progress updates and files, all linked here. Client, package and lines are read from the quotation.", "Ringkasan projek menjadikan sebut harga ini kerja penghantaran: tugasan untuk pasukan, kemas kini kemajuan dan fail, semua dipautkan di sini. Pelanggan, pakej dan baris dibaca daripada sebut harga.")}</p>
      {state.suggested_owner?.name && <p className={pw.note}>{L(`Suggested Project Owner: ${state.suggested_owner.name} (the CEO or COO confirms).`, `Cadangan Pemilik Projek: ${state.suggested_owner.name} (CEO atau COO mengesahkan).`)}</p>}
      {state.can_create
        ? <button type="button" className={btnClass} disabled={busy} aria-busy={busy || undefined} onClick={() => void create()}>{busy ? L("Creating…", "Mencipta…") : L("Create project brief", "Cipta ringkasan projek")}</button>
        : state.can_record_acceptance
          ? <>
            <p className={pw.note}>{L("The customer has not agreed to proceed yet. Record their acceptance first - the project starts after that.", "Pelanggan belum bersetuju meneruskan. Rekod penerimaan mereka dahulu - projek bermula selepas itu.")}</p>
            <button type="button" className={btnClass} onClick={() => setAccepting(true)}><AppIcon name="verify" />{L("Record acceptance", "Rekod penerimaan")}</button>
          </>
          : state.quotation_state?.label === "expired"
            ? <p className={pw.note}>{L("This quotation has expired and was not accepted - revise it first.", "Sebut harga ini telah tamat tempoh dan tidak diterima - semak semula dahulu.")}</p>
            : <p className={pw.note}>{L("The quotation's salesperson or the CEO, COO or CCO record the customer's acceptance and create its project brief.", "Jurujual sebut harga atau CEO, COO atau CCO merekod penerimaan pelanggan dan mencipta ringkasan projeknya.")}</p>}
      <Problem text={problem} />
      {toastNode}
      {accepting && <AcceptanceSheet quotationId={quotationId} docNumber={docNumber ?? `#${quotationId}`} company={company ?? ""} contact={contact} onClose={() => setAccepting(false)}
        onDone={(t, x) => { setAccepting(false); showToast(t, x); setTick((n) => n + 1); }} />}
    </div>
  );
}
