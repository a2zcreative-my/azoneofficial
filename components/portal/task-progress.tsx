"use client";

/* v1.246.0 - TASK PROGRESS on the screen (the owner's brief "Task
   Assignment, Progress Reporting, Comments & Quotation Project Integration",
   approved 01-11-2026, decisions T-1 to T-9; reference pictures 02 and 03).

   One set of pieces for every task, standalone or on a project:
     TaskProgressTabs  Details · Updates & Comments · Files · Activity, with
                       the review bar and the helpers (the Tasks drawer puts its
                       own task information inside Details)
     TaskDrawer        the same, as its own drawer (project rows, the phone)
     UpdateSheet       picture 03's "Add Status Update": status, progress,
                       update/comment (500), files, Post Update

   Every write goes to the task's own routes (worker/src/tasks-progress.ts):
   the server decides who may, stamps the author and the time, and keeps the
   record append-only. Nothing is shown as saved before the server says so -
   these writes are once-only, so they are never queued offline. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, csrfFetch } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { LineTabs } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { btnClass, btnSm, btnSmPrimary, btnSmSuccess, btnSmDanger, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, selectClass, textareaClass } from "@/lib/ui-styles";
import tp from "./task-progress.module.css";

/* ---------------- shapes the server sends ---------------- */
export type Latest = { id: number; kind: string; body: string; at: string; by: string | null; by_id: number };
export interface TaskDetail {
  task: {
    id: number; title: string; description: string | null; assigned_to: number; created_by: number | null; priority: string; deadline: string | null;
    status: "open" | "in_progress" | "completed"; stage: string | null; progress: number; progress_source: "checklist" | "manual"; created_at: string;
    assignee: string | null; assignee_position: string | null; assignee_photo: string | null; creator: string | null; acknowledged_at: string | null;
    assistants: { id: number; name: string; photo_key: string | null; added_at: string }[];
    items: { id: number; title: string; done: number; done_at: string | null; done_by_name: string | null }[];
    link: { kind: string; id: number; label: string; project_id?: number; quotation_id?: number; quotation?: string; customer?: string } | null;
    latest_update: Latest | null; counts: { updates: number; files: number; comments: number | null };
  };
  me: number;
  can: {
    edit: boolean; reassign: boolean; assistants: boolean; tick: boolean; update: boolean; comment: boolean; files: boolean; restricted_files: boolean;
    request_review: boolean; review: boolean; approve: boolean; cancel: boolean; assist: boolean; self_set: boolean; is_assignee: boolean; is_assistant: boolean;
  };
}
type TFile = { id: number; update_id: number | null; comment_id: number | null; file_name: string; content_type: string | null; size_bytes: number | null; level: string; created_at: string; uploader: string; open: boolean };
type TUpdate = {
  id: number; author_id: number; author: string; photo_key: string | null; kind: string; body: string; completed_work: string | null; blockers: string | null;
  next_action: string | null; status_to: string | null; stage_to: string | null; progress_snapshot: number | null; corrects_id: number | null; created_at: string; files: TFile[];
};
type TComment = { id: number; user_id: number; author: string; photo_key: string | null; comment: string; created_at: string; mentions: { id: number; name: string }[]; files: Omit<TFile, "update_id" | "uploader" | "open" | "created_at">[] };
type TActivity = { key: string; at: string; kind: string; text: string; by: string | null; photo_key?: string | null; quote?: string | null; muted?: boolean };

/* ---------------- words ---------------- */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asMyt = (v: string) => new Date(Date.parse(v.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z")) + 8 * 3600 * 1000);
export function stamp(v: string | null | undefined): string {
  if (!v) return "—";
  const d = asMyt(v);
  if (Number.isNaN(d.getTime())) return v;
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}
export function day(v: string | null | undefined): string {
  if (!v) return "—";
  const d = v.length > 10 ? asMyt(v) : new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const size = (b: number | null) => (b ? (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : "");
/** The state a task is in, in words: status and stage together (T-7). */
export function stateOf(status: string, stage: string | null): { label: string; cls: string } {
  if (status === "completed") return stage === "cancelled" ? { label: L("Cancelled", "Dibatalkan"), cls: chipSmNeutral } : { label: L("Completed", "Selesai"), cls: chipSmSuccess };
  if (stage === "review") return { label: L("Ready for Review", "Sedia untuk Semakan"), cls: chipSmWarn };
  if (stage === "blocked") return { label: L("Blocked", "Terhalang"), cls: chipSmDanger };
  if (stage === "waiting_client") return { label: L("Waiting for Client", "Menunggu Pelanggan"), cls: chipSmWarn };
  if (status === "in_progress") return { label: L("In Progress", "Sedang Berjalan"), cls: chipSmInfo };
  return { label: L("Open", "Terbuka"), cls: chipSmNeutral };
}
/** The task's own record, reloaded when `tick` moves. */
export function useTaskDetail(taskId: number | null, tick: number): { d: TaskDetail | null; error: string } {
  const [state, setState] = useState<{ d: TaskDetail | null; error: string; for: number | null }>({ d: null, error: "", for: null });
  useEffect(() => {
    if (!taskId) return;
    const c = new AbortController();
    void api<TaskDetail & { error?: { message?: string } }>(`/staff/tasks/${taskId}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      setState(r.ok && r.data?.task ? { d: r.data, error: "", for: taskId } : { d: null, error: r.data?.error?.message ?? L("This task could not be opened.", "Tugasan ini tidak dapat dibuka."), for: taskId });
    });
    return () => c.abort();
  }, [taskId, tick]);
  return state.for === taskId ? { d: state.d, error: state.error } : { d: null, error: "" };
}

export function StateChip({ status, stage }: { status: string; stage: string | null }) {
  const s = stateOf(status, stage);
  return <span className={s.cls}>{s.label}</span>;
}
const KIND: Record<string, [string, string, string]> = {
  progress: ["Update", "Kemas kini", chipSmInfo], blocker: ["Blocker", "Halangan", chipSmDanger], waiting_client: ["Waiting for client", "Menunggu pelanggan", chipSmWarn],
  review_request: ["Ready for review", "Sedia disemak", chipSmWarn], review_approved: ["Approved", "Diluluskan", chipSmSuccess], review_returned: ["Returned", "Dikembalikan", chipSmDanger],
  correction: ["Correction", "Pembetulan", chipSmNeutral], assist_request: ["Offer to help", "Tawaran membantu", chipSmNeutral], cancel: ["Cancelled", "Dibatalkan", chipSmNeutral],
  comment: ["Comment", "Komen", chipSmNeutral],
};
function KindChip({ kind }: { kind: string }) {
  const k = KIND[kind] ?? [kind, kind, chipSmNeutral];
  return <span className={k[2]}>{L(k[0], k[1])}</span>;
}
function Problem({ text }: { text: string }) { return text ? <p className={tp.warn} role="alert">{text}</p> : null; }
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } finally { setBusy(false); } };
  return { busy, run };
}
const fileUrl = (taskId: number, fileId: number) => `/api/v1/staff/tasks/${taskId}/files/${fileId}`;
const isImage = (ct: string | null) => !!ct && /^image\/(jpeg|png|webp)$/.test(ct);

/** Upload files one after another to the task; the first refusal is returned. */
async function uploadFiles(taskId: number, files: File[], link: { update?: number; comment?: number }, level: "team" | "restricted" = "team"): Promise<string> {
  for (const f of files) {
    const r = await csrfFetch(`/api/v1/staff/tasks/${taskId}/files`, { method: "POST", body: f, headers: {
      "Content-Type": f.type || "application/octet-stream", "X-File-Name": f.name, "X-File-Level": level,
      ...(link.update ? { "X-Update-Id": String(link.update) } : {}), ...(link.comment ? { "X-Comment-Id": String(link.comment) } : {}),
    } });
    if (!r.ok) { const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null; return `${f.name}: ${j?.error?.message ?? r.status}`; }
  }
  return "";
}

/* ======================================================================= */
/** Details · Updates & Comments · Files · Activity (picture 02). */
export function TaskProgressTabs({ taskId, details, onChanged, start = "details" }: { taskId: number; details?: ReactNode; onChanged?: () => void; start?: "details" | "updates" | "files" | "activity" }) {
  const [tab, setTab] = useState<"details" | "updates" | "files" | "activity">(start);
  const [tick, setTick] = useState(0);
  const { d, error } = useTaskDetail(taskId, tick);
  const [sheet, setSheet] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  const changed = (title?: string, sub?: string) => { if (title) toast(title, sub ?? ""); setTick((n) => n + 1); onChanged?.(); };
  if (error) return <p className={tp.warn} role="alert">{error}</p>;
  if (!d) return <SkelRows rows={4} />;
  const n = d.task.counts.updates + (d.task.counts.comments ?? 0);
  const tabs = [
    ["details", L("Details", "Butiran")],
    ["updates", L(`Updates & Comments (${n})`, `Kemas Kini & Komen (${n})`)],
    ["files", L(`Files (${d.task.counts.files})`, `Fail (${d.task.counts.files})`)],
    ["activity", L("Activity", "Aktiviti")],
  ] as const;
  return (
    <div className={tp.wrap} data-testid="task-progress">
      {toastNode}
      <LineTabs value={tab} onChange={setTab} tabs={tabs} label={L("Task sections", "Bahagian tugasan")} />
      <div hidden={tab !== "details"} className={tp.tabsGap}>
        <ReviewBar d={d} onChanged={changed} onUpdate={() => setSheet(true)} />
        <ExtraFacts d={d} onChanged={changed} />
        {details ?? <DefaultDetails d={d} onChanged={changed} />}
      </div>
      <div hidden={tab !== "updates"} className={tp.tabsGap}>
        {tab === "updates" && <UpdatesComments d={d} tick={tick} onChanged={changed} onUpdate={() => setSheet(true)} />}
      </div>
      <div hidden={tab !== "files"} className={tp.tabsGap}>
        {tab === "files" && <FilesPanel d={d} tick={tick} onChanged={changed} />}
      </div>
      <div hidden={tab !== "activity"} className={tp.tabsGap}>
        {tab === "activity" && <ActivityPanel taskId={d.task.id} tick={tick} />}
      </div>
      {d.can.update && d.task.status !== "completed" && (
        <div className={tp.sticky}>
          <button type="button" className={`${btnClass} ${tp.submit}`} onClick={() => setSheet(true)} data-testid="add-update"><AppIcon name="add" className="erp-icon" />{L("Add Update", "Tambah Kemas Kini")}</button>
        </div>
      )}
      {sheet && <UpdateSheet d={d} onClose={() => setSheet(false)} onDone={(t, s) => { setSheet(false); changed(t, s); }} />}
    </div>
  );
}

/** The same, as its own drawer - a project's task row, a link from a bell. */
export function TaskDrawer({ taskId, onClose, onChanged }: { taskId: number; onClose: () => void; onChanged?: () => void }) {
  const { d } = useTaskDetail(taskId, 0);
  return (
    <SideDrawer open onClose={onClose} wide full title={d?.task.title ?? L("Task", "Tugasan")}
      subtitle={d ? <span className={tp.helpers}><StateChip status={d.task.status} stage={d.task.stage} />{d.task.deadline ? <span className={chipSmNeutral}>{L(`Due ${day(d.task.deadline)}`, `Akhir ${day(d.task.deadline)}`)}</span> : null}</span> : undefined}>
      <TaskProgressTabs taskId={taskId} onChanged={onChanged} />
    </SideDrawer>
  );
}

/* ---------------- Details: the review bar ---------------- */
function ReviewBar({ d, onChanged, onUpdate }: { d: TaskDetail; onChanged: (t?: string, s?: string) => void; onUpdate: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { busy, run } = useBusy();
  const [problem, setProblem] = useState("");
  const t = d.task;
  const decide = (decision: "approve" | "return" | "cancel") => run(async () => {
    setProblem("");
    let reason = "";
    if (decision !== "approve") {
      const got = await prompt({
        title: decision === "return" ? L("Return for more work", "Kembalikan untuk diperbaiki") : L("Cancel this task", "Batalkan tugasan ini"),
        message: decision === "return" ? L("Say what still needs doing - the person doing it is told.", "Nyatakan apa yang perlu dibuat - pelaksana dimaklumkan.") : L("The task closes as cancelled, with your reason on its record.", "Tugasan ditutup sebagai dibatalkan, dengan sebab anda dalam rekod."),
        label: L("Reason", "Sebab"), required: true, variant: decision === "cancel" ? "danger" : "default",
        confirmLabel: decision === "return" ? L("Return", "Kembalikan") : L("Cancel task", "Batalkan tugasan"),
      });
      if (!got) return;
      reason = got.value;
    }
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/review`, { method: "POST", body: JSON.stringify({ decision, reason }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onChanged(decision === "approve" ? L("Approved", "Diluluskan") : decision === "return" ? L("Returned", "Dikembalikan") : L("Cancelled", "Dibatalkan"),
      decision === "approve" ? L("The task is completed, with your name on the record.", "Tugasan selesai, dengan nama anda dalam rekod.") : L("The people on the task are told.", "Mereka yang terlibat dimaklumkan."));
  });
  const closed = t.status === "completed";
  const line = closed ? (t.stage === "cancelled" ? L("This task was cancelled.", "Tugasan ini dibatalkan.") : L("This task is completed.", "Tugasan ini selesai."))
    : t.stage === "review" ? L("Waiting for review - the person who set it, the Project Owner or management approves it or sends it back.", "Menunggu semakan - yang menetapkan, Pemilik Projek atau pengurusan meluluskan atau mengembalikannya.")
    : t.stage === "blocked" ? L("Blocked - see the latest update for what is in the way.", "Terhalang - lihat kemas kini terkini.")
    : t.stage === "waiting_client" ? L("Waiting for the client.", "Menunggu pelanggan.")
    : d.can.self_set ? L("You set this task yourself - close it when it is done.", "Anda menetapkan tugasan ini sendiri - tutup apabila siap.")
    : L("Completion is approved by the person who set it, the Project Owner or management.", "Penyelesaian diluluskan oleh yang menetapkan, Pemilik Projek atau pengurusan.");
  return (
    <div className={tp.bar} data-testid="review-bar">
      {promptNode}
      <span className={tp.barText}>
        <span><StateChip status={t.status} stage={t.stage} /> · {t.progress}% <span className={tp.barSub}>{t.progress_source === "checklist" ? L("from the checklist", "daripada senarai semak") : L("reported in updates", "dilaporkan dalam kemas kini")}</span></span>
        <span className={tp.barSub}>{line}</span>
        {t.latest_update && <span className={tp.barSub}>{L("Latest", "Terkini")}: “{t.latest_update.body.slice(0, 90)}” — {t.latest_update.by} · {stamp(t.latest_update.at)}</span>}
      </span>
      <span className={tp.barCmds}>
        {d.can.request_review && <button type="button" className={btnSm} onClick={onUpdate}>{L("Submit for review", "Hantar untuk semakan")}</button>}
        {d.can.review && <button type="button" className={btnSmSuccess} disabled={busy} onClick={() => void decide("approve")}>{L("Approve", "Luluskan")}</button>}
        {d.can.review && <button type="button" className={btnSm} disabled={busy} onClick={() => void decide("return")}>{L("Return", "Kembalikan")}</button>}
        {!d.can.review && d.can.approve && !d.can.self_set && !closed && t.stage !== "review" && <button type="button" className={btnSm} disabled={busy} onClick={() => void decide("approve")}>{L("Close as completed", "Tutup sebagai selesai")}</button>}
        {d.can.cancel && !d.can.self_set && <button type="button" className={btnSmDanger} disabled={busy} onClick={() => void decide("cancel")}>{L("Cancel task", "Batalkan")}</button>}
      </span>
      <Problem text={problem} />
    </div>
  );
}

/* ---------------- Details: what it is about, who helps, when acknowledged ---------------- */
type Staff = { id: number; name: string; position?: string | null };
function ExtraFacts({ d, onChanged: showToast }: { d: TaskDetail; onChanged: (t?: string, s?: string) => void }) {
  const t = d.task;
  const [adding, setAdding] = useState(false);
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [pick, setPick] = useState(0);
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  useEffect(() => {
    if (!adding) return;
    let alive = true;
    void api<{ staff: Staff[] }>("/staff/staff-list").then((r) => { if (alive) setStaff(r.data?.staff ?? []); });
    return () => { alive = false; };
  }, [adding]);
  const add = () => run(async () => {
    setProblem("");
    if (!pick) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/assistants`, { method: "POST", body: JSON.stringify({ user_id: pick }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not added", "Tidak ditambah")); return; }
    setAdding(false); setPick(0);
    showToast(L("Helper added", "Pembantu ditambah"), L("They see the task in their Tasks and are told.", "Mereka melihat tugasan dalam Tugasan dan dimaklumkan."));
  });
  const remove = (uid: number) => run(async () => {
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/assistants/${uid}`, { method: "DELETE" });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not removed", "Tidak dibuang")); return; }
    showToast(L("Helper removed", "Pembantu dibuang"), L("The task stays on their record as helped.", "Tugasan kekal dalam rekod mereka sebagai dibantu."));
  });
  return (
    <dl className={tp.facts} aria-label={L("Who and what", "Siapa dan apa")}>
      {t.link && <div><dt>{t.link.kind === "project" ? L("Project", "Projek") : L("About", "Berkaitan")}</dt><dd>{t.link.label}{t.link.quotation ? ` · ${t.link.quotation}` : ""}{t.link.customer ? ` · ${t.link.customer}` : ""}</dd></div>}
      <div><dt>{L("Acknowledged", "Diakui")}</dt><dd>{d.can.self_set ? L("Not needed — self-set", "Tidak perlu — ditetapkan sendiri") : t.acknowledged_at ? stamp(t.acknowledged_at) : L("Not yet", "Belum")}</dd></div>
      <div>
        <dt>{L("Helping", "Membantu")}</dt>
        <dd className={tp.helpers}>
          {t.assistants.length === 0 && !adding && <span className={tp.barSub}>{L("Nobody yet", "Belum ada")}</span>}
          {t.assistants.map((a) => (
            <span key={a.id} className={tp.helper}><Avatar name={a.name} photoKey={a.photo_key} size="sm" />{a.name}
              {d.can.assistants && <button type="button" aria-label={L(`Remove ${a.name}`, `Buang ${a.name}`)} disabled={busy} onClick={() => void remove(a.id)}>×</button>}
            </span>
          ))}
          {d.can.assistants && !adding && <button type="button" className={btnSm} onClick={() => setAdding(true)}><AppIcon name="add" className="erp-icon" />{L("Add helper", "Tambah pembantu")}</button>}
          {adding && (staff === null ? <Skel h="2.25rem" w="12rem" /> : (
            <span className={tp.helpers}>
              <select className={selectClass} aria-label={L("Helper", "Pembantu")} value={pick || ""} onChange={(e) => setPick(Number(e.target.value) || 0)}>
                <option value="">{L("Choose a staff member", "Pilih kakitangan")}</option>
                {staff.filter((s) => s.id !== t.assigned_to && !t.assistants.some((a) => a.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.position ? ` · ${s.position}` : ""}</option>)}
              </select>
              <button type="button" className={btnSmPrimary} disabled={busy || !pick} onClick={() => void add()}>{L("Add", "Tambah")}</button>
              <button type="button" className={btnSm} onClick={() => setAdding(false)}>{L("Cancel", "Batal")}</button>
            </span>
          ))}
          <Problem text={problem} />
        </dd>
      </div>
    </dl>
  );
}

/** Task information + checklist, for a task opened outside the Tasks tab. */
function DefaultDetails({ d, onChanged }: { d: TaskDetail; onChanged: (t?: string, s?: string) => void }) {
  const t = d.task;
  const { run } = useBusy();
  const tick = (itemId: number) => run(async () => {
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/items/${itemId}/toggle`, { method: "POST", body: "{}" });
    if (r.ok) onChanged();
  });
  const done = t.items.filter((i) => i.done).length;
  return (
    <>
      <dl className={tp.facts}>
        <div><dt>{L("Assigned to", "Diberikan kepada")}</dt><dd>{t.assignee}{t.assignee_position ? ` · ${t.assignee_position}` : ""}</dd></div>
        <div><dt>{L("Created by", "Dibuat oleh")}</dt><dd>{t.creator ?? "—"}</dd></div>
        <div><dt>{L("Priority", "Keutamaan")}</dt><dd>{t.priority}</dd></div>
        <div><dt>{L("Deadline", "Tarikh akhir")}</dt><dd>{day(t.deadline)}</dd></div>
      </dl>
      {t.description && <p className={tp.entryText}>{t.description}</p>}
      {t.items.length > 0 && (
        <section aria-label={L("Deliverables checklist", "Senarai semak hasil kerja")} className={tp.form}>
          <p className={tp.quickTitle}>{L(`Deliverables checklist (${done}/${t.items.length})`, `Senarai semak hasil kerja (${done}/${t.items.length})`)}</p>
          <span className={tp.range}><span className={tp.track}><span className={tp.fill} style={{ width: `${t.progress}%` }} /></span><span className={tp.pct}>{t.progress}%</span></span>
          {t.items.map((i) => (
            <label key={i.id} className={tp.fileName}>
              <input type="checkbox" checked={!!i.done} disabled={!d.can.tick} onChange={() => void tick(i.id)} />
              <span>{i.title}{i.done && i.done_by_name ? <span className={tp.fileMeta}> · {i.done_by_name}</span> : null}</span>
            </label>
          ))}
        </section>
      )}
    </>
  );
}

/* ---------------- Updates & Comments (picture 02) ---------------- */
function UpdatesComments({ d, tick, onChanged, onUpdate }: { d: TaskDetail; tick: number; onChanged: (t?: string, s?: string) => void; onUpdate: () => void }) {
  const t = d.task;
  const [data, setData] = useState<{ updates: TUpdate[]; comments: TComment[] } | null>(null);
  const [show, setShow] = useState<"all" | "updates" | "comments">("all");
  const [mode, setMode] = useState<"comment" | "progress">(d.can.comment ? "comment" : "progress");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const { prompt, node: promptNode } = usePrompt();
  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ updates: TUpdate[] }>(`/staff/tasks/${t.id}/updates`),
      d.can.comment ? api<{ comments: TComment[] }>(`/staff/tasks/${t.id}/comments`) : Promise.resolve({ ok: true, data: { comments: [] as TComment[] } }),
    ]).then(([u, c]) => { if (alive) setData({ updates: u.data?.updates ?? [], comments: c.data?.comments ?? [] }); });
    return () => { alive = false; };
  }, [t.id, tick, d.can.comment]);
  const feed = useMemo(() => {
    if (!data) return [];
    const ups = data.updates.map((u) => ({ key: `u${u.id}`, at: u.created_at, kind: u.kind, who: u.author, photo: u.photo_key, text: u.body, u, c: null as TComment | null }));
    const cms = data.comments.map((c) => ({ key: `c${c.id}`, at: c.created_at, kind: "comment", who: c.author, photo: c.photo_key, text: c.comment, u: null as TUpdate | null, c }));
    return [...(show === "comments" ? [] : ups), ...(show === "updates" ? [] : cms)].sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
  }, [data, show]);
  const post = () => run(async () => {
    setProblem("");
    const body = text.trim();
    if (!body) { setProblem(L("Write something first.", "Tulis sesuatu dahulu.")); return; }
    if (mode === "comment") {
      /* @Name mentions the people on the task the server will accept */
      const people = [{ id: t.assigned_to, name: t.assignee ?? "" }, ...t.assistants.map((a) => ({ id: a.id, name: a.name })), ...(t.created_by ? [{ id: t.created_by, name: t.creator ?? "" }] : [])];
      const mentions = people.filter((p) => p.name && body.toLowerCase().includes(`@${p.name.split(" ")[0]!.toLowerCase()}`)).map((p) => p.id);
      const r = await api<{ id?: number; error?: { message?: string } }>(`/staff/tasks/${t.id}/comments`, { method: "POST", body: JSON.stringify({ comment: body, mentions }) });
      if (!r.ok || !r.data?.id) { setProblem(r.data?.error?.message ?? L("Not posted - check the connection and try again.", "Tidak dihantar - semak sambungan dan cuba lagi.")); return; }
      const bad = files.length ? await uploadFiles(t.id, files, { comment: r.data.id }) : "";
      setText(""); setFiles([]);
      onChanged(L("Comment posted", "Komen dihantar"), bad ? L(`A file was not attached - ${bad}`, `Fail tidak dilampirkan - ${bad}`) : "");
      return;
    }
    const r = await api<{ id?: number; error?: { message?: string } }>(`/staff/tasks/${t.id}/updates`, { method: "POST", body: JSON.stringify({ kind: "progress", body }) });
    if (!r.ok || !r.data?.id) { setProblem(r.data?.error?.message ?? L("Not posted - check the connection and try again.", "Tidak dihantar - semak sambungan dan cuba lagi.")); return; }
    const bad = files.length ? await uploadFiles(t.id, files, { update: r.data.id }) : "";
    setText(""); setFiles([]);
    onChanged(L("Update posted", "Kemas kini dihantar"), bad ? L(`A file was not attached - ${bad}`, `Fail tidak dilampirkan - ${bad}`) : L("It stays on the task's record with your name and the time.", "Ia kekal dalam rekod tugasan dengan nama anda dan masa."));
  });
  const correct = (u: TUpdate) => run(async () => {
    const got = await prompt({ title: L("Correct this update", "Betulkan kemas kini ini"), message: L("The original stays on the record; your correction is added under it.", "Asal kekal dalam rekod; pembetulan anda ditambah."), label: L("Correction", "Pembetulan"), required: true, confirmLabel: L("Add correction", "Tambah pembetulan") });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/updates`, { method: "POST", body: JSON.stringify({ kind: "correction", corrects_id: u.id, body: got.value }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onChanged(L("Correction added", "Pembetulan ditambah"));
  });
  const canWrite = (d.can.comment || d.can.update) && t.status !== "completed";
  return (
    <>
      {promptNode}
      {canWrite && (
        <div className={tp.quick} data-testid="quick-update">
          <div className={tp.quickHead}>
            <p className={tp.quickTitle}>{L("Quick Update", "Kemas Kini Pantas")}</p>
            {d.can.comment && d.can.update && (
              <span className={tp.seg} role="group" aria-label={L("Post as", "Hantar sebagai")}>
                <button type="button" aria-pressed={mode === "comment"} onClick={() => setMode("comment")}>{L("Comment", "Komen")}</button>
                <button type="button" aria-pressed={mode === "progress"} onClick={() => setMode("progress")}>{L("Progress update", "Kemas kini kemajuan")}</button>
              </span>
            )}
          </div>
          <textarea className={textareaClass} rows={2} maxLength={mode === "comment" ? 2000 : 500} value={text} onChange={(e) => setText(e.target.value)}
            aria-label={mode === "comment" ? L("Comment", "Komen") : L("Progress update", "Kemas kini kemajuan")}
            placeholder={mode === "comment" ? L("Ask, answer or note something for the team… (@name mentions)", "Tanya, jawab atau catat untuk pasukan… (@nama)") : L("What was done, what is next…", "Apa yang siap, apa seterusnya…")} />
          <div className={tp.quickRow}>
            <label className={tp.attach}><AppIcon name="attach" className="erp-icon" />{files.length ? L(`${files.length} file(s)`, `${files.length} fail`) : L("Attach", "Lampir")}
              <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
            </label>
            <span className={tp.barCmds}>
              {d.can.update && <button type="button" className={btnSm} onClick={onUpdate}>{L("Full status update", "Kemas kini status penuh")}</button>}
              <button type="button" className={btnSmPrimary} disabled={busy} aria-busy={busy || undefined} onClick={() => void post()}>{busy ? L("Posting…", "Menghantar…") : L("Post Update", "Hantar")}</button>
            </span>
          </div>
          <Problem text={problem} />
        </div>
      )}
      {d.can.assist && <AssistOffer taskId={t.id} onChanged={onChanged} />}
      <div className={tp.filter} role="group" aria-label={L("Show", "Tunjuk")}>
        {(["all", "updates", "comments"] as const).filter((k) => k !== "comments" || d.can.comment).map((k) => (
          <button key={k} type="button" className={btnSm} aria-pressed={show === k} onClick={() => setShow(k)}>{{ all: L("All", "Semua"), updates: L("Updates", "Kemas kini"), comments: L("Comments", "Komen") }[k]}</button>
        ))}
      </div>
      {data === null ? <SkelRows rows={3} /> : feed.length === 0 ? <p className={tp.empty}>{L("No progress report yet.", "Belum ada laporan kemajuan.")}</p> : (
        <ol className={tp.feed} data-testid="task-feed">
          {feed.map((e) => (
            <li key={e.key} className={`${tp.entry} ${e.kind === "comment" ? tp.entryMuted : ""}`} data-kind={e.kind}>
              <span className={tp.entryHead}>
                <span className={tp.entryWho}><Avatar name={e.who} photoKey={e.photo} size="sm" />{e.who}</span>
                <span>· {stamp(e.at)}</span>
                <KindChip kind={e.kind} />
                {e.u && e.u.progress_snapshot !== null && e.u.kind !== "correction" && <span>{e.u.progress_snapshot}%</span>}
                {e.u && (e.u.author_id === d.me || d.can.reassign) && !["correction", "review_approved", "review_returned", "cancel", "assist_request"].includes(e.u.kind) && t.status !== "completed" && d.can.update && (
                  <button type="button" className={tp.entryCmd} onClick={() => void correct(e.u!)}>{L("Correct", "Betulkan")}</button>
                )}
              </span>
              <p className={tp.entryText}>{e.text}</p>
              {e.u && (e.u.completed_work || e.u.blockers || e.u.next_action) && (
                <p className={tp.entryExtra}>
                  {e.u.completed_work && <span><b>{L("Done", "Siap")}:</b> {e.u.completed_work}</span>}
                  {e.u.blockers && <span><b>{L("Blocking", "Halangan")}:</b> {e.u.blockers}</span>}
                  {e.u.next_action && <span><b>{L("Next", "Seterusnya")}:</b> {e.u.next_action}</span>}
                </p>
              )}
              {e.c && e.c.mentions.length > 0 && <p className={tp.entryExtra}>{L("Mentions", "Sebut")}: {e.c.mentions.map((m) => `@${m.name}`).join(", ")}</p>}
              <FileStrip taskId={t.id} files={(e.u?.files ?? e.c?.files ?? []) as TFile[]} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function AssistOffer({ taskId, onChanged }: { taskId: number; onChanged: (t?: string, s?: string) => void }) {
  const { prompt, node } = usePrompt();
  const { busy, run } = useBusy();
  const [problem, setProblem] = useState("");
  const offer = () => run(async () => {
    const got = await prompt({ title: L("Offer to help", "Tawar untuk membantu"), message: L("The Project Owner is told and may add you to the task.", "Pemilik Projek dimaklumkan dan boleh menambah anda."), label: L("How you can help", "Bagaimana anda boleh membantu"), required: true, confirmLabel: L("Send", "Hantar") });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${taskId}/updates`, { method: "POST", body: JSON.stringify({ kind: "assist_request", body: got.value }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent", "Tidak dihantar")); return; }
    onChanged(L("Offer sent", "Tawaran dihantar"), L("The Project Owner has been told.", "Pemilik Projek telah dimaklumkan."));
  });
  return (
    <div className={tp.bar}>
      {node}
      <span className={tp.barText}><span>{L("You can read this task. To post progress or comments, offer to help.", "Anda boleh membaca tugasan ini. Untuk menghantar kemajuan atau komen, tawarkan bantuan.")}</span></span>
      <button type="button" className={btnSm} disabled={busy} onClick={() => void offer()}><AppIcon name="users" className="erp-icon" />{L("Offer to help", "Tawar membantu")}</button>
      <Problem text={problem} />
    </div>
  );
}

function FileStrip({ taskId, files }: { taskId: number; files: TFile[] }) {
  if (!files.length) return null;
  const imgs = files.filter((f) => isImage(f.content_type) && f.open !== false);
  const docs = files.filter((f) => !imgs.includes(f));
  return (
    <>
      {imgs.length > 0 && (
        <span className={tp.thumbs}>
          {imgs.slice(0, 4).map((f) => (
            <a key={f.id} className={tp.thumb} href={fileUrl(taskId, f.id)} target="_blank" rel="noopener noreferrer" aria-label={f.file_name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file streamed by the API, not a static asset */}
              <img src={fileUrl(taskId, f.id)} alt={f.file_name} loading="lazy" />
            </a>
          ))}
          {imgs.length > 4 && <span className={tp.thumb}><span className={tp.pct}>+{imgs.length - 4}</span></span>}
        </span>
      )}
      {docs.length > 0 && (
        <span className={tp.fileChips}>
          {docs.map((f) => f.open === false
            ? <span key={f.id} className={tp.fileChip}><AppIcon name="lock" className="erp-icon" />{f.file_name}<span className={tp.fileMeta}>{L("restricted", "terhad")}</span></span>
            : <a key={f.id} className={tp.fileChip} href={fileUrl(taskId, f.id)} target="_blank" rel="noopener noreferrer"><AppIcon name="document" className="erp-icon" />{f.file_name}{f.size_bytes ? <span className={tp.fileMeta}>{size(f.size_bytes)}</span> : null}<AppIcon name="download" className="erp-icon" /></a>)}
        </span>
      )}
    </>
  );
}

/* ---------------- Files ---------------- */
function FilesPanel({ d, tick, onChanged }: { d: TaskDetail; tick: number; onChanged: (t?: string, s?: string) => void }) {
  const t = d.task;
  const [files, setFiles] = useState<TFile[] | null>(null);
  const [level, setLevel] = useState<"team" | "restricted">("team");
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  useEffect(() => {
    let alive = true;
    void api<{ files: TFile[] }>(`/staff/tasks/${t.id}/files`).then((r) => { if (alive) setFiles(r.data?.files ?? []); });
    return () => { alive = false; };
  }, [t.id, tick]);
  const upload = (list: File[]) => run(async () => {
    setProblem("");
    const bad = await uploadFiles(t.id, list, {}, level);
    if (bad) { setProblem(bad); return; }
    onChanged(L("File added", "Fail ditambah"), L("Private to the task - opened only from here.", "Peribadi kepada tugasan - dibuka dari sini sahaja."));
  });
  return (
    <section aria-label={L("Files", "Fail")} data-testid="task-files" className={tp.form}>
      {files === null ? <SkelRows rows={2} /> : files.length === 0 ? <p className={tp.empty}>{L("No files yet.", "Belum ada fail.")}</p> : (
        <div className={tp.fileList}>
          {files.map((f) => (
            <div key={f.id} className={tp.fileRow}>
              <span className={tp.fileName}><AppIcon name={f.open ? "document" : "lock"} className="erp-icon" />
                {f.open ? <a className={tp.link} href={fileUrl(t.id, f.id)} target="_blank" rel="noopener noreferrer">{f.file_name}</a> : <span>{f.file_name}</span>}
                {f.level === "restricted" && <span className={chipSmWarn}>{L("Restricted", "Terhad")}</span>}
              </span>
              <span className={tp.fileMeta}>{f.uploader} · {stamp(f.created_at)}{f.size_bytes ? ` · ${size(f.size_bytes)}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {d.can.files && t.status !== "completed" && (
        <div className={tp.quickRow}>
          {d.can.restricted_files && (
            <label className={fieldLabel}>{L("Who may open it", "Siapa boleh membukanya")}
              <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as "team" | "restricted")}>
                <option value="team">{L("Everyone who can see the task", "Semua yang boleh melihat tugasan")}</option>
                <option value="restricted">{L("Restricted: owner, assigner and management", "Terhad: pemilik, penetap dan pengurusan")}</option>
              </select>
            </label>
          )}
          <label className={`${btnSm} ${tp.attach}`} aria-disabled={busy || undefined}><AppIcon name="upload" className="erp-icon" />{L("Add files (PDF, image, Word)", "Tambah fail (PDF, imej, Word)")}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; if (l.length) void upload(l); }} />
          </label>
        </div>
      )}
      <Problem text={problem} />
    </section>
  );
}

/* ---------------- Activity ---------------- */
function ActivityPanel({ taskId, tick }: { taskId: number; tick: number }) {
  const [items, setItems] = useState<TActivity[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ activity: TActivity[] }>(`/staff/tasks/${taskId}/activity`).then((r) => { if (alive) setItems(r.data?.activity ?? []); });
    return () => { alive = false; };
  }, [taskId, tick]);
  if (items === null) return <SkelRows rows={4} />;
  if (!items.length) return <p className={tp.empty}>{L("Nothing has happened yet.", "Belum ada aktiviti.")}</p>;
  return (
    <ol className={tp.feed} data-testid="task-activity">
      {[...items].reverse().map((e) => (
        <li key={e.key} className={`${tp.entry} ${e.muted ? tp.entryMuted : ""}`} data-kind={e.kind}>
          <span className={tp.entryHead}>
            {e.by && <span className={tp.entryWho}><Avatar name={e.by} photoKey={e.photo_key ?? null} size="sm" />{e.by}</span>}
            <span>{e.by ? "· " : ""}{stamp(e.at)}</span>
          </span>
          <p className={tp.entryText}>{e.text}</p>
          {e.quote && <p className={tp.entryExtra}>“{e.quote}”</p>}
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Add Status Update (picture 03) ---------------- */
export function UpdateSheet({ d, onClose, onDone }: { d: TaskDetail; onClose: () => void; onDone: (title: string, sub?: string) => void }) {
  const t = d.task;
  const initial = t.stage === "blocked" ? "blocked" : t.stage === "waiting_client" ? "waiting_client" : "in_progress";
  const [state, setState] = useState<"in_progress" | "waiting_client" | "blocked" | "review">(initial);
  const [progress, setProgress] = useState<number>(t.progress);
  const [text, setText] = useState("");
  const [extra, setExtra] = useState({ completed_work: "", blockers: "", next_action: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState("");
  const { busy, run } = useBusy();
  const fromChecklist = t.progress_source === "checklist" && t.items.length > 0;
  const done = t.items.filter((i) => i.done).length;
  const submit = () => run(async () => {
    setProblem("");
    if (!text.trim()) { setProblem(L("Write the update.", "Tulis kemas kini.")); return; }
    if (state === "blocked" && !text.trim() && !extra.blockers.trim()) { setProblem(L("Say what is blocking the task.", "Nyatakan halangan.")); return; }
    const kind = state === "blocked" ? "blocker" : state === "waiting_client" ? "waiting_client" : state === "review" ? "review_request" : "progress";
    const r = await api<{ id?: number; error?: { message?: string } }>(`/staff/tasks/${t.id}/updates`, { method: "POST", body: JSON.stringify({
      kind, body: text.trim(), ...extra, ...(!fromChecklist && progress !== t.progress ? { progress } : {}),
    }) });
    if (!r.ok || !r.data?.id) { setProblem(r.data?.error?.message ?? L("Not saved - check the connection and try again. Nothing was recorded.", "Tidak disimpan - semak sambungan dan cuba lagi. Tiada yang direkodkan.")); return; }
    const bad = files.length ? await uploadFiles(t.id, files, { update: r.data.id }) : "";
    onDone(state === "review" ? L("Submitted for review", "Dihantar untuk semakan") : L("Update saved", "Kemas kini disimpan"),
      bad ? L(`The update is saved; a file was not attached - ${bad}`, `Kemas kini disimpan; fail tidak dilampirkan - ${bad}`)
        : state === "review" ? L("The person who set it is told; they approve it or send it back.", "Yang menetapkan dimaklumkan; mereka meluluskan atau mengembalikannya.")
        : L("It stays on the task's record with your name and the time.", "Ia kekal dalam rekod tugasan dengan nama anda dan masa."));
  });
  return (
    <SideDrawer open onClose={onClose} full title={L("Add Status Update", "Tambah Kemas Kini Status")}
      footer={<button type="button" className={`${btnClass} ${tp.submit}`} disabled={busy} aria-busy={busy || undefined} onClick={() => void submit()} data-testid="post-update">{busy ? L("Posting…", "Menghantar…") : L("Post Update", "Hantar Kemas Kini")}</button>}>
      <div className={tp.form} data-testid="update-sheet">
        <div className={tp.taskHead}>
          <span className={tp.taskHeadIcon}><AppIcon name="document" /></span>
          <div><p className={tp.taskHeadName}>{t.title}</p><p className={tp.taskHeadSub}>{t.link?.quotation ?? t.link?.label ?? L(`Due ${day(t.deadline)}`, `Akhir ${day(t.deadline)}`)}</p></div>
        </div>
        <label className={fieldLabel}>{L("Status", "Status")}
          <select className={selectClass} value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={L("Status", "Status")}>
            <option value="in_progress">{L("In Progress", "Sedang Berjalan")}</option>
            <option value="waiting_client">{L("Waiting for Client", "Menunggu Pelanggan")}</option>
            <option value="blocked">{L("On Hold / Blocked", "Ditangguh / Terhalang")}</option>
            {d.can.request_review && <option value="review">{L("Ready for Review", "Sedia untuk Semakan")}</option>}
          </select>
        </label>
        <div className={fieldLabel}>
          <span>{L("Progress", "Kemajuan")}</span>
          {fromChecklist ? (
            <>
              <span className={tp.range}><span className={tp.track}><span className={tp.fill} style={{ width: `${t.progress}%` }} /></span><span className={tp.pct}>{t.progress}%</span></span>
              <p className={tp.note}>{L(`From the checklist (${done}/${t.items.length}) - tick the deliverables to move it.`, `Daripada senarai semak (${done}/${t.items.length}) - tanda hasil kerja untuk menggerakkannya.`)}</p>
            </>
          ) : (
            <span className={tp.range}>
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} aria-label={L("Progress percent", "Peratus kemajuan")} />
              <span className={tp.pct}>{progress}%</span>
            </span>
          )}
        </div>
        <label className={fieldLabel}>{L("Update / Comment", "Kemas kini / Komen")}
          <textarea className={textareaClass} rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <span className={tp.counter}>{text.length}/500</span>
        <details open={state === "blocked"}>
          <summary className={tp.note}>{L("Completed work, blockers, next action", "Kerja siap, halangan, tindakan seterusnya")}</summary>
          <div className={tp.extras}>
            {(["completed_work", "blockers", "next_action"] as const).map((k) => (
              <label key={k} className={fieldLabel}>{{ completed_work: L("Completed work", "Kerja siap"), blockers: L("What is blocking it", "Apa yang menghalang"), next_action: L("Next action", "Tindakan seterusnya") }[k]}
                <input className={inputClass} maxLength={1000} value={extra[k]} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </details>
        {d.can.files && (
          <label className={tp.attach}><AppIcon name="attach" className="erp-icon" />{files.length ? L(`${files.length} file(s) attached`, `${files.length} fail dilampirkan`) : L("Attach files (optional)", "Lampirkan fail (pilihan)")}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
          </label>
        )}
        {state === "review" && <p className={tp.note}>{L("Your task goes for review. It is completed when the person who set it (or the Project Owner or management) approves it.", "Tugasan anda dihantar untuk semakan. Ia selesai apabila yang menetapkan (atau Pemilik Projek atau pengurusan) meluluskannya.")}</p>}
        <Problem text={problem} />
      </div>
    </SideDrawer>
  );
}
