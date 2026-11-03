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
import { StageTimeline, type Stage, type StageState } from "@/components/ui/stage-timeline";
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
    /* v1.256.0 - the closure in force, what is still open, the one next step, the stages walked */
    closure?: { kind: string; at: string; by: string | null; summary: string | null; late_days: number | null } | null;
    outstanding?: { id: number; title: string }[];
    next?: string;
    timeline?: { key: string; state: StageState; who: string | null; at: string | null; text: string | null; flags?: Record<string, string | number | boolean> }[];
    reported?: { value: number; at: string; by: string | null } | null; // v1.257.0 - the latest reported %, beside the official one
  };
  me: number;
  can: {
    edit: boolean; reassign: boolean; assistants: boolean; tick: boolean; update: boolean; comment: boolean; files: boolean; restricted_files: boolean;
    request_review: boolean; review: boolean; approve: boolean; cancel: boolean; assist: boolean; self_set: boolean; is_assignee: boolean; is_assistant: boolean; remind?: boolean;
    close?: boolean; close_exception?: boolean; reopen?: boolean; return?: boolean;
  };
}
type TFile = { id: number; update_id: number | null; comment_id: number | null; file_name: string; content_type: string | null; size_bytes: number | null; level: string; created_at: string; uploader: string; open: boolean };
type TUpdate = {
  id: number; author_id: number; author: string; photo_key: string | null; kind: string; body: string; completed_work: string | null; blockers: string | null;
  next_action: string | null; status_to: string | null; stage_to: string | null; progress_snapshot: number | null; progress_source?: string | null; corrects_id: number | null; created_at: string; files: TFile[];
  /* v1.257.0 - the reported percentage; the edits (newest last) and the withdrawal; whether this person may change it */
  reported_progress?: number | null;
  edits?: { id: number; body: string; completed_work: string | null; blockers: string | null; next_action: string | null; by: string; at: string }[];
  withdrawn?: { by: string; at: string; reason: string } | null; can_edit?: boolean;
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
  if (status === "completed") return stage === "cancelled" ? { label: L("Cancelled", "Dibatalkan"), cls: chipSmNeutral } : { label: L("Closed", "Ditutup"), cls: chipSmSuccess }; // v1.256.0 - the owner's word
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
  review_request: ["Ready for review", "Sedia disemak", chipSmWarn], review_approved: ["Approved & closed", "Diluluskan & ditutup", chipSmSuccess], review_returned: ["Returned", "Dikembalikan", chipSmDanger],
  correction: ["Correction", "Pembetulan", chipSmNeutral], assist_request: ["Offer to help", "Tawaran membantu", chipSmNeutral], cancel: ["Cancelled", "Dibatalkan", chipSmDanger],
  closed: ["Closed", "Ditutup", chipSmSuccess], closed_with_exception: ["Closed - exception", "Ditutup - pengecualian", chipSmWarn], reopened: ["Reopened", "Dibuka semula", chipSmWarn], created: ["Created", "Dicipta", chipSmNeutral],
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
export function TaskProgressTabs({ taskId, details, onChanged, start = "details", startSheet = false }: { taskId: number; details?: ReactNode; onChanged?: () => void; start?: "details" | "updates" | "files" | "activity"; startSheet?: boolean }) {
  const [tab, setTab] = useState<"details" | "updates" | "files" | "activity">(start);
  const [tick, setTick] = useState(0);
  const { d, error } = useTaskDetail(taskId, tick);
  /* v1.256.0 - ONE LAYER: Add Status Update opens inside this drawer (not a
     second drawer over it); "close" opens it on Closed */
  const [sheet, setSheetRaw] = useState<false | "update" | "close">(startSheet ? "update" : false);
  const setSheet = (v: boolean | "update" | "close") => setSheetRaw(v === true ? "update" : v);
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
  if (sheet) {
    return (
      <div className={tp.wrap} data-testid="task-progress">
        {toastNode}
        <UpdateSheet d={d} start={sheet === "close" ? "closed" : undefined} onClose={() => setSheet(false)} onDone={(t, s) => { setSheet(false); changed(t, s); }} />
      </div>
    );
  }
  return (
    <div className={tp.wrap} data-testid="task-progress">
      {toastNode}
      <LineTabs value={tab} onChange={setTab} tabs={tabs} label={L("Task sections", "Bahagian tugasan")} />
      <div hidden={tab !== "details"} className={tp.tabsGap}>
        <ReviewBar d={d} onChanged={changed} onUpdate={() => setSheet(true)} onClose={() => setSheet("close")} />
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
      {(d.can.update || d.can.close) && d.task.status !== "completed" && (
        <div className={tp.sticky}>
          <button type="button" className={`${btnClass} ${tp.submit}`} onClick={() => setSheet(true)} data-testid="add-update"><AppIcon name="add" className="erp-icon" />{L("Update status", "Kemas kini status")}</button>
        </div>
      )}
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

/* ---------------- Details: the stages, the next step, the decisions ----------------
   v1.256.0 (claude/TASK-CLOSURE-AUDIT.md) - the task's stage timeline (the
   same component as Leave and Claims), the ONE next step in words, the
   closure in force, and exactly the decisions the server offers this
   person. Every decision goes to the one transition (tasks-progress.ts). */
const STAGE_TITLE: Record<string, [string, string]> = {
  created: ["Created", "Dicipta"], acknowledged: ["Acknowledged", "Diakui"], in_progress: ["In progress", "Sedang berjalan"],
  review: ["Ready for review", "Sedia untuk semakan"], closed: ["Closed", "Ditutup"], cancelled: ["Cancelled", "Dibatalkan"],
};
function taskStages(d: TaskDetail): Stage[] {
  const t = d.task;
  return (t.timeline ?? []).map((s) => {
    const f = s.flags ?? {};
    const title = s.key === "in_progress" && f.blocked ? L("Blocked", "Terhalang") : s.key === "in_progress" && f.waiting ? L("Waiting for the client", "Menunggu pelanggan")
      : s.key === "review" && s.state === "returned" ? L("Returned for more work", "Dikembalikan untuk diperbaiki")
      : L(STAGE_TITLE[s.key]?.[0] ?? s.key, STAGE_TITLE[s.key]?.[1] ?? s.key);
    const who = [s.who, s.at ? stamp(s.at) : null].filter(Boolean).join(" · ");
    const sub = s.state === "todo" ? (s.key === "review" ? L("The person who set it approves or returns it", "Yang menetapkan meluluskan atau mengembalikan") : s.key === "closed" ? L("Not closed yet", "Belum ditutup") : L("Not yet", "Belum"))
      : s.state === "skipped" ? L("Not recorded", "Tidak direkod") : who || undefined;
    const note = s.key === "in_progress" && f.reopened_at ? L(`Reopened by ${f.reopened_by} · ${stamp(String(f.reopened_at))}: ${s.text ?? ""}`, `Dibuka semula oleh ${f.reopened_by} · ${stamp(String(f.reopened_at))}: ${s.text ?? ""}`)
      : s.text ?? undefined;
    const warn = f.exception ? L("Closed with deliverables still open (management exception)", "Ditutup dengan hasil kerja belum siap (pengecualian pengurusan)")
      : typeof f.late_days === "number" && f.late_days > 0 ? L(`${f.late_days} day(s) after the due date`, `${f.late_days} hari selepas tarikh akhir`) : undefined;
    return { key: s.key, title, sub, note, warn, state: s.state, aside: s.state === "now" ? L("Now", "Kini") : undefined };
  });
}
const nextLine = (d: TaskDetail): string => {
  const t = d.task; const out = t.outstanding ?? [];
  switch (t.next) {
    case "closed": return L("Closed. It stays in the completed records; an authorised person may reopen it with a reason.", "Ditutup. Ia kekal dalam rekod selesai; orang yang dibenarkan boleh membukanya semula dengan sebab.");
    case "cancelled": return L("Cancelled. Management may reopen it with a reason.", "Dibatalkan. Pengurusan boleh membukanya semula dengan sebab.");
    case "review_decide": return L("Ready for review - approve and close it, or return it with what still needs doing.", "Sedia untuk semakan - luluskan dan tutup, atau kembalikan dengan apa yang perlu dibuat.");
    case "review_wait": return L("Waiting for review - the person who set it, the Project Owner or management approves it or sends it back.", "Menunggu semakan - yang menetapkan, Pemilik Projek atau pengurusan meluluskan atau mengembalikannya.");
    case "blocked": return L("Blocked - see the latest update for what is in the way.", "Terhalang - lihat kemas kini terkini.");
    case "waiting_client": return L("Waiting for the client.", "Menunggu pelanggan.");
    case "outstanding": return L(`${out.length} deliverable(s) still open: ${out.map((x) => x.title).join("; ")}. Tick them when done - the task closes after that.`, `${out.length} hasil kerja belum siap: ${out.map((x) => x.title).join("; ")}. Tandakan apabila siap - tugasan ditutup selepas itu.`);
    case "close_ready": return t.items.length ? L("Every deliverable is done. Close the task with a short completion summary.", "Semua hasil kerja siap. Tutup tugasan dengan ringkasan penyelesaian.") : L(`Reported ${t.progress}%. When the work is done, close the task with a short completion summary - a percentage never closes it.`, `Dilaporkan ${t.progress}%. Apabila kerja siap, tutup tugasan dengan ringkasan - peratusan tidak menutupnya.`);
    case "submit_review": return L("When the work is done, submit it for review - the person who set it closes it.", "Apabila kerja siap, hantar untuk semakan - yang menetapkan menutupnya.");
    default: return d.can.self_set ? L("You set this task yourself - close it when it is done.", "Anda menetapkan tugasan ini sendiri - tutup apabila siap.") : L("Completion is approved by the person who set it, the Project Owner or management.", "Penyelesaian diluluskan oleh yang menetapkan, Pemilik Projek atau pengurusan.");
  }
};
function ReviewBar({ d, onChanged, onUpdate, onClose }: { d: TaskDetail; onChanged: (t?: string, s?: string) => void; onUpdate: () => void; onClose: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { busy, run } = useBusy();
  const [problem, setProblem] = useState("");
  const t = d.task;
  const ask = async (title: string, message: string, confirmLabel: string, danger = false) => (await prompt({ title, message, label: L("Reason", "Sebab"), required: true, variant: danger ? "danger" : "default", confirmLabel }))?.value ?? "";
  const send = (reopen: boolean, body: Record<string, unknown>, done: [string, string]) => run(async () => {
    setProblem("");
    const init = { method: "POST", body: JSON.stringify(body) }; // the once-only key rides in the Idempotency-Key header (lib/outbox.ts ONCE_ONLY)
    const r = reopen ? await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/reopen`, init) : await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/review`, init);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onChanged(done[0], done[1]);
  });
  const doReturn = async () => { const reason = await ask(L("Return for more work", "Kembalikan untuk diperbaiki"), L("Say what still needs doing - the person doing it is told.", "Nyatakan apa yang perlu dibuat - pelaksana dimaklumkan."), L("Return", "Kembalikan")); if (reason) await send(false, { decision: "return", reason }, [L("Returned", "Dikembalikan"), L("The people on the task are told.", "Mereka yang terlibat dimaklumkan.")]); };
  const doCancel = async () => { const reason = await ask(L("Cancel this task", "Batalkan tugasan ini"), L("The task closes as cancelled, with your reason on its record.", "Tugasan ditutup sebagai dibatalkan, dengan sebab anda dalam rekod."), L("Cancel task", "Batalkan tugasan"), true); if (reason) await send(false, { decision: "cancel", reason }, [L("Cancelled", "Dibatalkan"), L("The people on the task are told.", "Mereka yang terlibat dimaklumkan.")]); };
  const doReopen = async () => { const reason = await ask(L("Reopen this task", "Buka semula tugasan ini"), L("It goes back to In progress. The closing record, the checklist and the progress stay as they are.", "Ia kembali kepada Sedang berjalan. Rekod penutupan, senarai semak dan kemajuan kekal."), L("Reopen task", "Buka semula")); if (reason) await send(true, { reason }, [L("Reopened", "Dibuka semula"), L("The task is back in the active lists; the people on it are told.", "Tugasan kembali dalam senarai aktif; mereka yang terlibat dimaklumkan.")]); };
  /* v1.247.0 - a reminder to the assignee: the bell, and the official email
     when the sender is on; with a reason; once per task every 12 hours */
  const remind = () => run(async () => {
    setProblem("");
    const got = await prompt({
      title: L("Send a reminder", "Hantar peringatan"),
      message: L(`${t.assignee ?? "The assignee"} gets a notification and, when email is on, an email from hello@a2zcreative.my with your reason. One reminder per task every 12 hours.`, `${t.assignee ?? "Penerima"} menerima notifikasi dan, apabila e-mel dihidupkan, e-mel daripada hello@a2zcreative.my dengan sebab anda. Satu peringatan setiap 12 jam bagi setiap tugasan.`),
      label: L("Reason", "Sebab"), required: true, confirmLabel: L("Send reminder", "Hantar peringatan"),
    });
    if (!got) return;
    const r = await api<{ email?: boolean; email_to?: string | null; why?: string | null; error?: { message?: string } }>(`/staff/tasks/${t.id}/remind`, { method: "POST", body: JSON.stringify({ reason: got.value }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent", "Tidak dihantar")); return; }
    onChanged(L("Reminder sent", "Peringatan dihantar"), r.data?.email ? L(`Notification sent; the email is queued for ${r.data.email_to}.`, `Notifikasi dihantar; e-mel dalam giliran untuk ${r.data.email_to}.`) : L(`Notification sent in the portal. No email: ${r.data?.why ?? "email is off"}.`, `Notifikasi dihantar dalam portal. Tiada e-mel: ${r.data?.why ?? "e-mel dimatikan"}.`));
  });
  const closed = t.status === "completed";
  const c = t.closure;
  const stages = taskStages(d);
  return (
    <div className={tp.decide} data-testid="review-bar">
      {promptNode}
      {closed && c && (
        <div className={t.stage === "cancelled" ? tp.closedOff : tp.closedOk} data-testid="closure">
          <AppIcon name={t.stage === "cancelled" ? "error" : "success"} className="erp-icon" />
          <span className={tp.barText}>
            <strong>{t.stage === "cancelled" ? L(`Cancelled ${stamp(c.at)}`, `Dibatalkan ${stamp(c.at)}`) : L(`Closed ${stamp(c.at)}`, `Ditutup ${stamp(c.at)}`)}{c.by ? ` · ${c.by}` : ""}</strong>
            {c.summary && <span className={tp.barSub}>{c.summary}</span>}
            {t.stage !== "cancelled" && (c.late_days ? <span className={tp.barSub}>{L(`Closed ${c.late_days} day(s) after the due date (${day(t.deadline)}).`, `Ditutup ${c.late_days} hari selepas tarikh akhir (${day(t.deadline)}).`)}</span>
              : t.deadline ? <span className={tp.barSub}>{L("Closed on or before the due date.", "Ditutup pada atau sebelum tarikh akhir.")}</span> : null)}
          </span>
        </div>
      )}
      {stages.length > 0 && <StageTimeline stages={stages} label={L("Task progress", "Kemajuan tugasan")} testId="task-stages" />}
      <div className={tp.bar}>
        <span className={tp.barText}>
          <span><StateChip status={t.status} stage={t.stage} /> · {t.progress}% <span className={tp.barSub}>{t.progress_source === "checklist" ? L(`from the checklist (${t.items.filter((i) => i.done).length}/${t.items.length})`, `daripada senarai semak (${t.items.filter((i) => i.done).length}/${t.items.length})`) : L("reported in updates", "dilaporkan dalam kemas kini")}</span>
            {t.progress_source === "checklist" && t.reported && <span className={tp.barSub} data-testid="reported-line"> · {L(`last reported ${t.reported.value}% by ${t.reported.by ?? "—"}`, `terakhir dilaporkan ${t.reported.value}% oleh ${t.reported.by ?? "—"}`)}</span>}</span>
          <span className={tp.barSub} data-testid="next-step">{nextLine(d)}</span>
          {t.latest_update && <span className={tp.barSub}>{L("Latest", "Terkini")}: “{t.latest_update.body.slice(0, 90)}” — {t.latest_update.by} · {stamp(t.latest_update.at)}</span>}
        </span>
        <span className={tp.barCmds}>
          {d.can.request_review && <button type="button" className={btnSm} onClick={onUpdate}>{L("Submit for review", "Hantar untuk semakan")}</button>}
          {d.can.close && t.stage === "review" && !d.can.self_set && <button type="button" className={btnSmSuccess} disabled={busy} onClick={onClose}>{L("Approve & close", "Lulus & tutup")}</button>}
          {d.can.return && <button type="button" className={btnSm} disabled={busy} onClick={() => void doReturn()}>{L("Return", "Kembalikan")}</button>}
          {d.can.close && (t.stage !== "review" || d.can.self_set) && <button type="button" className={btnSmSuccess} disabled={busy} data-testid="close-task" onClick={onClose}>{L("Close task", "Tutup tugasan")}</button>}
          {d.can.reopen && <button type="button" className={btnSm} disabled={busy} data-testid="reopen-task" onClick={() => void doReopen()}>{L("Reopen", "Buka semula")}</button>}
          {d.can.cancel && <button type="button" className={btnSmDanger} disabled={busy} onClick={() => void doCancel()}>{L("Cancel task", "Batalkan")}</button>}
          {d.can.remind && <button type="button" className={btnSm} disabled={busy} data-testid="send-reminder" onClick={() => void remind()}>{L("Send reminder", "Hantar peringatan")}</button>}
        </span>
      </div>
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
const STATUS_KINDS = ["blocker", "waiting_client", "review_request", "review_approved", "review_returned", "cancel", "closed", "closed_with_exception", "reopened"];
function UpdatesComments({ d, tick, onChanged, onUpdate }: { d: TaskDetail; tick: number; onChanged: (t?: string, s?: string) => void; onUpdate: () => void }) {
  const t = d.task;
  const [data, setData] = useState<{ updates: TUpdate[]; comments: TComment[] } | null>(null);
  const [show, setShow] = useState<"all" | "updates" | "comments" | "progress" | "status">("all");
  const [more, setMore] = useState(false);
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
  /* v1.256.0 - the owner's timeline: every real event, newest first, the
     progress each update REPORTED (from -> to, and whether it was the
     checklist at that moment or a typed figure), ending with the task's
     creation. Nothing is invented: no row, no entry. */
  const feed = useMemo(() => {
    if (!data) return [];
    const chrono = [...data.updates].sort((a, b) => a.id - b.id);
    let last: number | null = null;
    const prevOf = new Map<number, number | null>();
    for (const u of chrono) { if (u.progress_snapshot !== null && u.kind !== "correction") { prevOf.set(u.id, last); last = u.progress_snapshot; } }
    const ups = data.updates.map((u) => ({ key: `u${u.id}`, at: u.created_at, kind: u.kind, who: u.author, photo: u.photo_key, text: u.body, u, c: null as TComment | null, prev: prevOf.get(u.id) ?? null }));
    const cms = data.comments.map((c) => ({ key: `c${c.id}`, at: c.created_at, kind: "comment", who: c.author, photo: c.photo_key, text: c.comment, u: null as TUpdate | null, c, prev: null as number | null }));
    const created = { key: `t${t.id}`, at: t.created_at, kind: "created", who: t.creator ?? t.assignee ?? "", photo: null as string | null, text: L(`Task "${t.title}" was created and assigned to ${t.assignee ?? "—"}.`, `Tugasan "${t.title}" dicipta dan ditugaskan kepada ${t.assignee ?? "—"}.`), u: null as TUpdate | null, c: null as TComment | null, prev: null as number | null };
    const pick = show === "comments" ? cms : show === "updates" ? ups : show === "progress" ? ups.filter((e) => ["progress", "correction"].includes(e.kind)) : show === "status" ? ups.filter((e) => STATUS_KINDS.includes(e.kind)) : [...ups, ...cms];
    return [...pick.sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key)), ...(show === "all" || show === "updates" ? [created] : [])];
  }, [data, show, t.id, t.created_at, t.creator, t.assignee, t.title]);
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
  /* v1.257.0 - EDIT and WITHDRAW (the owner: "Edit + Withdraw, history kept"):
     each is a new row on the record; the original words stay readable */
  const [editing, setEditing] = useState<{ id: number; body: string; next_action: string } | null>(null);
  const [orig, setOrig] = useState<Record<number, boolean>>({});
  const saveEdit = () => run(async () => {
    if (!editing) return;
    setProblem("");
    if (!editing.body.trim()) { setProblem(L("Write the update.", "Tulis kemas kini.")); return; }
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/updates/${editing.id}/edit`, { method: "POST", body: JSON.stringify({ body: editing.body.trim(), next_action: editing.next_action.trim() }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    setEditing(null);
    onChanged(L("Update edited", "Kemas kini disunting"), L("The original stays on the record - Show original opens it.", "Asal kekal dalam rekod - Tunjuk asal membukanya."));
  });
  const withdraw = (u: TUpdate) => run(async () => {
    const got = await prompt({ title: L("Withdraw this update", "Tarik balik kemas kini ini"), message: L("It leaves the timeline; a line says who withdrew it and why, and the original stays in the record. The task's status and progress stay as they are - use Update status to change them.", "Ia keluar dari garis masa; satu baris menyatakan siapa menarik balik dan sebabnya, dan asal kekal dalam rekod. Status dan kemajuan tugasan kekal - guna Kemas kini status untuk mengubahnya."), label: L("Reason", "Sebab"), required: true, variant: "danger", confirmLabel: L("Withdraw", "Tarik balik") });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/updates/${u.id}/withdraw`, { method: "POST", body: JSON.stringify({ reason: got.value }) });
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onChanged(L("Update withdrawn", "Kemas kini ditarik balik"), L("Who withdrew it and why is on the timeline.", "Siapa dan sebabnya ada pada garis masa."));
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
        {(["all", "updates", "comments", "progress", "status"] as const).filter((k) => k !== "comments" || d.can.comment).map((k) => (
          <button key={k} type="button" className={btnSm} aria-pressed={show === k} onClick={() => { setShow(k); setMore(false); }}>{{ all: L("All", "Semua"), updates: L("Updates", "Kemas kini"), comments: L("Comments", "Komen"), progress: L("Progress", "Kemajuan"), status: L("Status change", "Perubahan status") }[k]}</button>
        ))}
      </div>
      {data === null ? <SkelRows rows={3} /> : feed.length === 0 ? <p className={tp.empty}>{L("Nothing recorded here yet.", "Belum ada rekod di sini.")}</p> : (
        <>
          <ol className={tp.tl} data-testid="task-feed">
            {(more ? feed : feed.slice(0, 10)).map((e) => {
              const tone = e.kind === "created" || e.kind === "closed" || e.kind === "review_approved" ? tp.mGreen : e.kind === "comment" || e.kind === "assist_request" ? tp.mGrey
                : ["blocker", "review_returned", "cancel"].includes(e.kind) ? tp.mRed : ["waiting_client", "review_request", "reopened", "closed_with_exception"].includes(e.kind) ? tp.mAmber
                : e.kind === "correction" ? tp.mNavy : tp.mGold;
              const title = e.kind === "progress" ? L("Progress update", "Kemas kini kemajuan") : e.kind === "comment" ? L("Comment", "Komen") : e.kind === "created" ? L("Task created", "Tugasan dicipta")
                : L((KIND[e.kind] ?? [e.kind, e.kind])[0], (KIND[e.kind] ?? [e.kind, e.kind])[1]);
              const snap = e.u && e.u.progress_snapshot !== null && e.u.kind !== "correction" ? e.u.progress_snapshot : null;
              const last = e.u?.edits?.length ? e.u.edits[e.u.edits.length - 1]! : null;
              const showOrig = !!(e.u && orig[e.u.id]);
              const shown = e.u && last && !showOrig ? { ...e.u, body: last.body, completed_work: last.completed_work, blockers: last.blockers, next_action: last.next_action } : e.u;
              const gone = e.u?.withdrawn ?? null;
              if (gone && !showOrig) {
                return (
                  <li key={e.key} className={tp.tlRow} data-kind={e.kind} data-withdrawn="1">
                    <span className={tp.tlWhen}>{day(e.at)}<br />{stamp(e.at).split(", ")[1] ?? ""}</span>
                    <span className={`${tp.tlMark} ${tp.mGrey}`} aria-hidden="true" />
                    <div className={`${tp.tlCard} ${tp.entryMuted}`}>
                      <span className={tp.barSub}>{L(`${title} withdrawn by ${gone.by} · ${stamp(gone.at)}: ${gone.reason}`, `${title} ditarik balik oleh ${gone.by} · ${stamp(gone.at)}: ${gone.reason}`)}</span>
                      <button type="button" className={tp.entryCmd} onClick={() => setOrig({ ...orig, [e.u!.id]: true })}>{L("Show original", "Tunjuk asal")}</button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={e.key} className={tp.tlRow} data-kind={e.kind}>
                  <span className={tp.tlWhen}>{day(e.at)}<br />{stamp(e.at).split(", ")[1] ?? ""}</span>
                  <span className={`${tp.tlMark} ${tone}`} aria-hidden="true" />
                  <div className={`${tp.tlCard} ${e.kind === "comment" ? tp.entryMuted : ""}`}>
                    <span className={tp.tlHead}><strong>{title}</strong><KindChip kind={e.kind === "progress" ? "progress" : e.kind} /></span>
                    {editing && e.u && editing.id === e.u.id ? (
                      <div className={tp.editBox} data-testid="edit-update">
                        <textarea className={textareaClass} rows={3} maxLength={500} aria-label={L("Update text", "Teks kemas kini")} value={editing.body} onChange={(ev) => setEditing({ ...editing, body: ev.target.value })} />
                        <input className={inputClass} maxLength={1000} aria-label={L("Next action", "Tindakan seterusnya")} placeholder={L("Next action (optional)", "Tindakan seterusnya (pilihan)")} value={editing.next_action} onChange={(ev) => setEditing({ ...editing, next_action: ev.target.value })} />
                        <span className={tp.barCmds}>
                          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void saveEdit()}>{L("Save edit", "Simpan suntingan")}</button>
                          <button type="button" className={btnSm} onClick={() => setEditing(null)}>{L("Cancel", "Batal")}</button>
                        </span>
                      </div>
                    ) : (<>
                    <p className={tp.entryText}>{shown ? shown.body : e.text}</p>
                    {shown && (shown.completed_work || shown.blockers || shown.next_action) && (
                      <p className={tp.entryExtra}>
                        {shown.completed_work && <span><b>{L("Done", "Siap")}:</b> {shown.completed_work}</span>}
                        {shown.blockers && <span><b>{L("Blocking", "Halangan")}:</b> {shown.blockers}</span>}
                        {shown.next_action && <span><b>{L("Next", "Seterusnya")}:</b> {shown.next_action}</span>}
                      </p>
                    )}
                    </>)}
                    {(last || gone) && (
                      <span className={tp.barSub} data-testid="edited-mark">
                        {showOrig ? (gone ? L(`Original - withdrawn by ${gone.by} · ${stamp(gone.at)}: ${gone.reason}`, `Asal - ditarik balik oleh ${gone.by} · ${stamp(gone.at)}: ${gone.reason}`) : L("Original, as first written", "Asal, seperti mula ditulis"))
                          : L(`Edited by ${last!.by} · ${stamp(last!.at)}${e.u!.edits!.length > 1 ? ` (${e.u!.edits!.length} edits)` : ""}`, `Disunting oleh ${last!.by} · ${stamp(last!.at)}${e.u!.edits!.length > 1 ? ` (${e.u!.edits!.length} suntingan)` : ""}`)}
                        {" "}<button type="button" className={tp.entryCmd} onClick={() => setOrig({ ...orig, [e.u!.id]: !showOrig })}>{showOrig ? L("Show current", "Tunjuk terkini") : L("Show original", "Tunjuk asal")}</button>
                      </span>
                    )}
                    {snap !== null && (
                      <span className={tp.tlProg}>
                        <span className={tp.track}><span className={tp.fill} style={{ width: `${snap}%` }} /></span>
                        <span className={tp.tlPct}>{e.prev !== null ? `${e.prev}% → ${snap}%` : `${snap}%`}</span>
                        <span className={tp.barSub}>{e.u!.progress_source === "checklist"
                          ? (e.u!.reported_progress != null ? L(`Reported ${e.u!.reported_progress}% · the checklist then ${snap}% (official)`, `Dilaporkan ${e.u!.reported_progress}% · senarai semak ketika itu ${snap}% (rasmi)`) : L("the checklist at that time", "senarai semak pada masa itu"))
                          : L("reported", "dilaporkan")}</span>
                      </span>
                    )}
                    {e.c && e.c.mentions.length > 0 && <p className={tp.entryExtra}>{L("Mentions", "Sebut")}: {e.c.mentions.map((m) => `@${m.name}`).join(", ")}</p>}
                    <FileStrip taskId={t.id} files={(e.u?.files ?? e.c?.files ?? []) as TFile[]} />
                    <span className={tp.entryHead}>
                      {e.who && <span className={tp.entryWho}><Avatar name={e.who} photoKey={e.photo} size="sm" />{e.who}</span>}
                      {e.u?.can_edit && !editing && (
                        <span className={tp.entryCmds}>
                          <button type="button" className={tp.entryCmd} data-testid="edit-btn" onClick={() => setEditing({ id: e.u!.id, body: shown?.body ?? e.u!.body, next_action: shown?.next_action ?? "" })}>{L("Edit", "Sunting")}</button>
                          <button type="button" className={tp.entryCmd} data-testid="withdraw-btn" onClick={() => void withdraw(e.u!)}>{L("Withdraw", "Tarik balik")}</button>
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {!more && feed.length > 10 && <button type="button" className={`${btnSm} ${tp.moreBtn}`} onClick={() => setMore(true)}>{L(`Show more history (${feed.length - 10})`, `Tunjuk sejarah lagi (${feed.length - 10})`)}<AppIcon name="down" className="erp-icon" /></button>}
        </>
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

/* ---------------- Add Status Update (picture 03; v1.256.0 the owner's mockup) ----------------
   ONE form for every status move: In Progress, Waiting for Client, On Hold /
   Blocked, Ready for Review (the assignee of a task somebody else set) and
   Closed (whoever the server lets close it). It opens INSIDE the task drawer
   - one layer, one scroll, the Post button kept above the phone's bar.
   Closing needs a completion summary and every deliverable ticked; a
   manager may close with the reason for what is still open (D1). */
type SheetState = "in_progress" | "waiting_client" | "blocked" | "review" | "closed";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
export function UpdateSheet({ d, start, onClose, onDone }: { d: TaskDetail; start?: SheetState; onClose: () => void; onDone: (title: string, sub?: string) => void }) {
  const t = d.task;
  const initial: SheetState = start ?? (t.stage === "blocked" ? "blocked" : t.stage === "waiting_client" ? "waiting_client" : "in_progress");
  const [state, setState] = useState<SheetState>(initial);
  const [progress, setProgress] = useState<number>(t.progress);
  const [reported, setReported] = useState<string>(""); // v1.257.0 - on a checklist task, the percentage the author reports (the checklist stays official)
  const [text, setText] = useState("");
  const [open, setOpen] = useState({ completed_work: false, outstanding: false, blockers: initial === "blocked", next_action: false, follow_up: false });
  const [extra, setExtra] = useState({ completed_work: "", outstanding: "", blockers: "", next_action: "", follow_up: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [exception, setException] = useState(false);
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState("");
  const [key] = useState(newKey);
  const [todayMyt] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const { busy, run } = useBusy();
  const fromChecklist = t.progress_source === "checklist" && t.items.length > 0;
  const done = t.items.filter((i) => i.done).length;
  const outstanding = t.outstanding ?? t.items.filter((i) => !i.done).map((i) => ({ id: i.id, title: i.title }));
  const approving = t.stage === "review" && !d.can.self_set;
  const closing = state === "closed";
  const blockedClose = closing && outstanding.length > 0 && !(exception && d.can.close_exception);
  const options: [SheetState, string, string, boolean][] = [
    ["in_progress", "In Progress", "Sedang Berjalan", !!d.can.update],
    ["waiting_client", "Waiting for Client", "Menunggu Pelanggan", !!d.can.update],
    ["blocked", "On Hold / Blocked", "Ditangguh / Terhalang", !!d.can.update],
    ["review", "Ready for Review", "Sedia untuk Semakan", !!d.can.request_review],
    ["closed", approving ? "Closed (approve the review)" : "Closed", approving ? "Ditutup (luluskan semakan)" : "Ditutup", !!d.can.close],
  ];
  const submit = () => run(async () => {
    setProblem("");
    if (closing) {
      if (!approving && text.trim().length < 10) { setProblem(L("Write the completion summary - what was delivered (at least 10 characters).", "Tulis ringkasan penyelesaian - apa yang diserahkan (sekurang-kurangnya 10 aksara).")); return; }
      if (outstanding.length && !exception) { setProblem(L("Tick the open deliverables first, or close with an exception.", "Tandakan hasil kerja yang belum siap dahulu, atau tutup dengan pengecualian.")); return; }
      if (exception && why.trim().length < 10) { setProblem(L("Give the reason for closing with deliverables open (at least 10 characters).", "Beri sebab menutup dengan hasil kerja belum siap (sekurang-kurangnya 10 aksara).")); return; }
      const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}/close`, { method: "POST", body: JSON.stringify({ summary: text.trim(), exception: exception || undefined, exception_reason: exception ? why.trim() : undefined, client_key: key }) });
      if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not closed - check the connection and try again. Nothing was recorded.", "Tidak ditutup - semak sambungan dan cuba lagi. Tiada yang direkodkan.")); return; }
      const bad = files.length ? await uploadFiles(t.id, files, {}) : "";
      onDone(L("Task closed", "Tugasan ditutup"), bad ? L(`Closed; a file was not attached - ${bad}`, `Ditutup; fail tidak dilampirkan - ${bad}`) : L("Closed with your name, the time and your summary. It moves to the completed records.", "Ditutup dengan nama anda, masa dan ringkasan anda. Ia berpindah ke rekod selesai."));
      return;
    }
    if (!text.trim()) { setProblem(L("Write the update.", "Tulis kemas kini.")); return; }
    if (state === "blocked" && !text.trim() && !extra.blockers.trim()) { setProblem(L("Say what is blocking the task.", "Nyatakan halangan.")); return; }
    const kind = state === "blocked" ? "blocker" : state === "waiting_client" ? "waiting_client" : state === "review" ? "review_request" : "progress";
    const next = [open.next_action ? extra.next_action.trim() : "", open.follow_up && extra.follow_up ? L(`follow up by ${day(extra.follow_up)}`, `susulan sebelum ${day(extra.follow_up)}`) : ""].filter(Boolean).join(" - ");
    const body = [text.trim(), open.outstanding && extra.outstanding.trim() ? `${L("Outstanding", "Belum siap")}: ${extra.outstanding.trim()}` : ""].filter(Boolean).join("\n");
    const r = await api<{ id?: number; error?: { message?: string } }>(`/staff/tasks/${t.id}/updates`, { method: "POST", body: JSON.stringify({
      kind, body: body.slice(0, 500), client_key: key,
      ...(open.completed_work && extra.completed_work.trim() ? { completed_work: extra.completed_work.trim() } : {}),
      ...(open.blockers && extra.blockers.trim() ? { blockers: extra.blockers.trim() } : {}),
      ...(next ? { next_action: next } : {}),
      ...(!fromChecklist && progress !== t.progress ? { progress } : {}),
      ...(fromChecklist && reported !== "" ? { reported_progress: Number(reported) } : {}),
    }) });
    if (!r.ok || !r.data?.id) { setProblem(r.data?.error?.message ?? L("Not saved - check the connection and try again. Nothing was recorded.", "Tidak disimpan - semak sambungan dan cuba lagi. Tiada yang direkodkan.")); return; }
    const bad = files.length ? await uploadFiles(t.id, files, { update: r.data.id }) : "";
    onDone(state === "review" ? L("Submitted for review", "Dihantar untuk semakan") : L("Update saved", "Kemas kini disimpan"),
      bad ? L(`The update is saved; a file was not attached - ${bad}`, `Kemas kini disimpan; fail tidak dilampirkan - ${bad}`)
        : state === "review" ? L("The person who set it is told; they approve it or send it back.", "Yang menetapkan dimaklumkan; mereka meluluskan atau mengembalikannya.")
        : L("It stays on the task's record with your name and the time.", "Ia kekal dalam rekod tugasan dengan nama anda dan masa."));
  });
  const DETAILS = [
    ["completed_work", L("Completed work", "Kerja siap")], ["outstanding", L("Outstanding work", "Kerja belum siap")], ["blockers", L("Issues / Blockers", "Isu / Halangan")],
    ["next_action", L("Next action", "Tindakan seterusnya")], ["follow_up", L("Target / Follow-up date", "Tarikh sasaran / susulan")],
  ] as const;
  const PCT = [...new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, t.progress])].sort((a, b) => a - b);
  return (
    <section className={tp.sheet} data-testid="update-sheet" aria-label={L("Add Status Update", "Tambah Kemas Kini Status")}>
      <div className={tp.sheetHead}>
        <button type="button" className={btnSm} onClick={onClose} data-testid="sheet-back"><AppIcon name="previous" className="erp-icon" />{L("Back to task", "Kembali ke tugasan")}</button>
        <h3 className={tp.sheetTitle}>{L("Add Status Update", "Tambah Kemas Kini Status")}</h3>
      </div>
      <div className={tp.form}>
        <div className={tp.taskHead}>
          <span className={tp.taskHeadIcon}><AppIcon name="document" /></span>
          <div><p className={tp.taskHeadName}>{t.title}</p><p className={tp.taskHeadSub}>{t.link?.quotation ?? t.link?.label ?? L(`Due ${day(t.deadline)}`, `Akhir ${day(t.deadline)}`)}</p></div>
        </div>
        <div className={tp.twoCol}>
          <label className={fieldLabel}>{L("Status *", "Status *")}
            <select className={selectClass} value={state} onChange={(e) => setState(e.target.value as SheetState)} aria-label={L("Status", "Status")} data-testid="sheet-status">
              {options.filter((o) => o[3]).map(([v, en, ms]) => <option key={v} value={v}>{L(en, ms)}</option>)}
            </select>
          </label>
          <label className={fieldLabel}>{L("Progress", "Kemajuan")}
            {fromChecklist || closing
              ? <span className={tp.readonly}>{fromChecklist ? L(`${t.progress}% · checklist ${done}/${t.items.length}`, `${t.progress}% · senarai semak ${done}/${t.items.length}`) : `${t.progress}%`}</span>
              : <select className={selectClass} value={progress} onChange={(e) => setProgress(Number(e.target.value))} aria-label={L("Progress percent", "Peratus kemajuan")}>{PCT.map((p) => <option key={p} value={p}>{p}%</option>)}</select>}
          </label>
        </div>
        <span className={tp.range}><span className={tp.track}><span className={tp.fill} style={{ width: `${fromChecklist || closing ? t.progress : progress}%` }} /></span><span className={tp.pct}>{fromChecklist || closing ? t.progress : progress}%</span></span>
        {fromChecklist && !closing && <p className={tp.note}>{L(`From the checklist (${done}/${t.items.length}) - tick the deliverables to move it. A percentage never closes the task.`, `Daripada senarai semak (${done}/${t.items.length}) - tanda hasil kerja untuk menggerakkannya. Peratusan tidak menutup tugasan.`)}</p>}
        {fromChecklist && !closing && (
          <label className={fieldLabel}>{L("Reported progress (optional)", "Kemajuan dilaporkan (pilihan)")}
            <select className={selectClass} value={reported} onChange={(e) => setReported(e.target.value)} aria-label={L("Reported progress percent", "Peratus kemajuan dilaporkan")} data-testid="reported-progress">
              <option value="">{L("— not reported —", "— tidak dilaporkan —")}</option>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
            <span className={tp.note}>{L("Your own estimate of the work, kept on this update. The official progress stays the checklist.", "Anggaran anda sendiri, disimpan pada kemas kini ini. Kemajuan rasmi kekal senarai semak.")}</span>
          </label>
        )}
        <label className={fieldLabel}>{closing ? (approving ? L("Approval note (optional)", "Nota kelulusan (pilihan)") : L("Completion summary *", "Ringkasan penyelesaian *")) : L("Update / Comment *", "Kemas kini / Komen *")}
          <textarea className={textareaClass} rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} data-testid="sheet-text"
            placeholder={closing ? L("What was delivered, and where it is", "Apa yang diserahkan, dan di mana") : L("What was done, what is next…", "Apa yang siap, apa seterusnya…")} />
        </label>
        <span className={tp.counter}>{text.length} / 500</span>
        {closing && outstanding.length > 0 && (
          <div className={tp.outstanding} data-testid="sheet-outstanding">
            <p className={tp.outTitle}>{L(`${outstanding.length} deliverable(s) still open`, `${outstanding.length} hasil kerja belum siap`)}</p>
            <ul>{outstanding.map((o) => <li key={o.id}>{o.title}</li>)}</ul>
            {d.can.close_exception ? (
              <>
                <label className={tp.check}><input type="checkbox" checked={exception} onChange={(e) => setException(e.target.checked)} />{L("Close anyway, as a management exception (the items stay unticked)", "Tutup juga, sebagai pengecualian pengurusan (item kekal tidak bertanda)")}</label>
                {exception && <label className={fieldLabel}>{L("Reason for the exception *", "Sebab pengecualian *")}<input className={inputClass} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} /></label>}
              </>
            ) : <p className={tp.note}>{L("Tick them in the checklist when they are done - then close the task.", "Tandakan dalam senarai semak apabila siap - kemudian tutup tugasan.")}</p>}
          </div>
        )}
        {!closing && (
          <fieldset className={tp.details}>
            <legend className={tp.outTitle}>{L("Update details (optional)", "Butiran kemas kini (pilihan)")}</legend>
            {DETAILS.map(([k, label]) => (
              <div key={k} className={tp.detailRow}>
                <label className={tp.check}><input type="checkbox" checked={open[k]} onChange={(e) => setOpen({ ...open, [k]: e.target.checked })} />{label}</label>
                {open[k] && (k === "follow_up"
                  ? <input type="date" className={inputClass} aria-label={label} min={todayMyt} value={extra.follow_up} onChange={(e) => setExtra({ ...extra, follow_up: e.target.value })} />
                  : <input className={inputClass} aria-label={label} maxLength={k === "outstanding" ? 300 : 1000} value={extra[k]} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />)}
              </div>
            ))}
          </fieldset>
        )}
        {d.can.files && (
          <label className={tp.attach}><AppIcon name="attach" className="erp-icon" />{files.length ? L(`${files.length} file(s) attached`, `${files.length} fail dilampirkan`) : L("Attach files (optional)", "Lampirkan fail (pilihan)")}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
          </label>
        )}
        {state === "review" && <p className={tp.infoNote}>{L("Your task goes for review. It is closed when the person who set it (or the Project Owner or management) approves it.", "Tugasan anda dihantar untuk semakan. Ia ditutup apabila yang menetapkan (atau Pemilik Projek atau pengurusan) meluluskannya.")}</p>}
        {closing && <p className={tp.okNote}><b>{L("Closed", "Ditutup")}</b> {L("marks the task complete and final, with your name and the time. An authorised person can reopen it, with a reason, if more work is needed.", "menandakan tugasan selesai dan muktamad, dengan nama anda dan masa. Orang yang dibenarkan boleh membukanya semula, dengan sebab, jika perlu.")}</p>}
        <Problem text={problem} />
        <div className={tp.sticky}>
          <button type="button" className={`${btnClass} ${tp.submit}`} disabled={busy || blockedClose} aria-busy={busy || undefined} onClick={() => void submit()} data-testid="post-update">
            {busy ? L("Saving…", "Menyimpan…") : closing ? (approving ? L("Approve & close", "Lulus & tutup") : L("Close task", "Tutup tugasan")) : L("Post Update", "Hantar Kemas Kini")}
          </button>
        </div>
      </div>
    </section>
  );
}
