"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported.

   v1.200.0 - FIVE TABS, on the owner's mockup (23-10-2026): Overview, My
   Tasks, All Tasks (the roles that manage the team - the server answers
   ?all=1 only for them), Create / Assign Task, Reports & Archive. The same
   board read (/staff/tasks, remembered and refreshed), the same create, the
   same status dropdown with the same progress rule, the same acknowledge,
   scope checklist and CEO-only delete. New on screen: a task table with
   search, filters and sorting, a Board view of your own work (the three
   statuses the dropdown already has), what needs attention, the team's
   tallies from the rows already loaded, and the archive searchable. Every
   zone stays mounted and hides with tk.off. */
import { holds, canViewProjects } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { Sub } from "@/components/portal/leave";
import { L, MANAGE_ROLES, Task, TaskItem, User, priorityL } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { taskFigures } from "@/lib/task-figures"; // v1.203.0
import { btnClass, btnSm, btnSmPrimary, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClass, inputClassSm } from "@/lib/ui-styles";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { ProjectsBoard } from "@/components/portal/project-workspace"; // v1.245.0
import { TaskMailPanel } from "@/components/portal/task-mail-panel"; // v1.247.0
import { TaskReports } from "@/components/portal/task-reports"; // v1.306.0 - HR 4.0 (H-1): the written reports' one home
import { StateChip, TaskProgressTabs, day, stamp } from "@/components/portal/task-progress"; // v1.246.0 - progress, comments, files, activity
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { dmy } from "@/lib/format";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
import { SideDrawer } from "@/components/ui/side-drawer";
import { ViewSwitch } from "@/components/portal/executive-cards"; // v1.313.0 - the phone view switch
import { useTabViewAddress } from "@/lib/tab-view";
import { TodayAssignmentsCard } from "@/components/portal/dashboard-cards"; // v1.307.0 - Attendance 4.0 (A-3): the operational roster's home
import { RosterBoard } from "@/components/portal/lazy-panels";
import { revealAnchor } from "@/components/portal/page-shared";
import tk from "./tasks-page.module.css";
import t5 from "./tasks5.module.css"; // v1.313.0 - Tasks Workspace 5.0
import { DepartmentCard, Head5, LiveHostCard, MyDayCards, QuickApprovals, TaskPreview, WorkCalendar, WorkloadCard, byUrgency, mondayOf, prioWord } from "@/components/portal/tasks5";

/* v1.209.0 - Create left the tab row for a drawer from the + button (the
   owner's Tasks brief, 25-10-2026); Calendar joined it, drawn from the
   deadlines already loaded. */
type TaskView = "overview" | "mine" | "all" | "projects" | "calendar" | "reports";
/* v1.313.0 - Tasks 5.0: the view in the address (/portal?tab=Tasks&view=...), Back/Forward between views */
const TASK_VIEWS: readonly TaskView[] = ["overview", "mine", "all", "projects", "calendar", "reports"];
const isTaskView = (v: string | null): v is TaskView => TASK_VIEWS.includes(v as TaskView);
type StatusF = "active" | "open" | "in_progress" | "completed" | "any" | "review" | "blocked" | "waiting_client" | "overdue" | "stale" | "assisting" | "set_by_me";
type SortK = "newest" | "deadline" | "priority" | "title" | "progress";
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/* v1.247.2 - "Madam Jariah - QT-1 · Madam Jariah": the company is said once when
   the project's title already names it */
const projName = (label: string) => { const i = label.lastIndexOf(" · "); return i > 0 && label.slice(0, i).includes(label.slice(i + 3)) ? label.slice(0, i) : label; };
const PRIORITY_CHIP: Record<string, string> = { urgent: chipDanger, high: chipWarn, normal: chipInfo, low: chipNeutral };
/* v1.313.0 - the board's priority colours: High red, Medium amber, Low green (image 1/3) */
const PRIO_CHIP_5: Record<string, string> = { urgent: chipDanger, high: chipDanger, normal: chipWarn, low: chipSuccess };
/** rows on one page of the All Tasks and archive tables */
const PER = 15;
/** 20 Nov - the board's short due date (the year when it is not this one) */
const shortDate = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); const y = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear(); return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", ...(d.getUTCFullYear() !== y ? { year: "numeric" } : {}), timeZone: "UTC" }); };
const statusL = (v: string) => v === "completed" ? L("Closed", "Selesai") : v === "in_progress" ? L("In progress", "Sedang dibuat") : L("Open", "Terbuka");

/* ================= Tasks ================= */

export function Tasks({ user, progress, initialView, focus }: { user: User; progress?: ReactNode; initialView?: string; focus?: RecordFocus | null }) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    scope: "", // v1.42.0 — one deliverable per line → tickable task_items
    assigned_to: 0,
    priority: "normal",
    start_date: "", // v1.248.0 - the span of work: start to due (0163)
    deadline: "",
    quotation_id: 0, // v1.246.2 - set under a quotation: the task joins its project
  });
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [sheetFor, setSheetFor] = useState<number | null>(null); // v1.256.0 - the task opened straight on Add Status Update
  const [items, setItems] = useState<TaskItem[] | null>(null);
  /* v1.246.2 - the quotations this person may set a task under (their own,
     or every live one for the CEO, COO and CCO); read when the drawer opens */
  const [quotes, setQuotes] = useState<{ id: number; doc_number: string; company: string; label: string; project_id: number | null; project_title: string | null }[] | null>(null);
  /* v1.246.2 - the checklist being edited: a new line, a renamed item */
  const [newItem, setNewItem] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const { confirm: askDelete, node: deleteConfirmNode } = useConfirm();
  const { show: showTaskToast, node: taskToastNode } = useSaveToast();
  const canManage = MANAGE_ROLES.includes(user.role);
  const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed. Yesterday's
     board paints from the device at once; the fetch swaps the live one in
     behind it, and any write on a task bumps "tasks" so every open board
     refetches (the topic wiring moved INTO the hook).
     v1.77.0 (kept): skeleton until the first EVER fetch lands. */
  const board = useCachedApi<{ tasks: Task[] }>(`/staff/tasks${canManage ? "?all=1" : ""}`, true, ["tasks"]);
  const tasks = useMemo(() => board.data?.tasks ?? [], [board.data]);
  const loaded = !board.loading;
  /* v1.21.0 (CEO: "populate list of users instead of staff list data…
     staff name list should be populate full staff name"): the assignee
     picker read /staff/users — EVERY account, dupes, Super Admin and
     all. /staff-list is the one picker source: active staff only,
     full_name preferred. Used by Content/Sales already; now here too. */
  const roster = useCachedApi<{ staff: { id: number; name: string; role?: string; position?: string | null; department?: string | null }[] }>("/staff/staff-list", canManage, ["users"]); // v1.250.2 - staff only (agents get no tasks)
  const team = useMemo(() => roster.data?.staff ?? [], [roster.data]);
  const refreshBoard = board.refresh;
  const load = useCallback(async () => { refreshBoard(); }, [refreshBoard]);

  /* v1.203.0 - a Dashboard quick action may open a tab straight on its form */
  const [view, setView] = useState<TaskView>(() => (["overview", "mine", "all", "projects", "calendar", "reports"].includes(initialView ?? "") ? initialView as TaskView : "overview"));
  /* v1.306.0 - HR 4.0 (H-1): the written daily / weekly / monthly reports live
     here now. Mounted the first time Reports & Archive opens, then kept, so a
     half-typed report survives a look at another view. Shown to the roles the
     server lets submit them (task_reports - unchanged). */
  const [reportsSeen, setReportsSeen] = useState(view === "reports");
  if (view === "reports" && !reportsSeen) setReportsSeen(true);
  const canTaskReports = holds("task_reports", ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"].includes(user.role));
  /* the Dashboard's "Create task" still opens the form: it is a drawer now */
  const [createOpen, setCreateOpen] = useState(() => initialView === "create");
  const [projOpen, setProjOpen] = useState<number | null>(null); // v1.245.0 - the project open in Tasks > Projects
  /* v1.209.0 - THE TASK DRAWER: one task, its facts, its checklist and the
     commands the row always had. `openTask` (which checklist is loaded) is
     the drawer's task. */
  const [editing, setEditing] = useState<null | { title: string; description: string; priority: string; start_date: string; deadline: string; assigned_to: number }>(null);
  useTabViewAddress("Tasks", view, setView, isTaskView);
  const go = (v: TaskView, anchor?: string) => {
    setView(v);
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };

  useEffect(() => {
    if (!createOpen) return;
    let alive = true;
    void api<{ quotations: { id: number; doc_number: string; company: string; label: string; project_id: number | null; project_title: string | null }[] }>(`/staff/projects/quotations`)
      .then((r) => { if (alive) setQuotes(r.ok ? r.data?.quotations ?? [] : []); });
    return () => { alive = false; };
  }, [createOpen]);
  const create = async () => {
    if (!draft.title) return;
    // Staff self-assign; managers may pick someone. 0 = self on the server.
    const payload = {
      ...draft,
      assigned_to: draft.assigned_to || undefined,
      quotation_id: draft.quotation_id || undefined,
      start_date: draft.start_date || undefined,
      // v1.42.0: the scope, one line per deliverable
      items: draft.scope.split("\n").map((l) => l.trim()).filter(Boolean),
    };
    const r = await api(`/staff/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    /* v1.200.0 - the form says what happened, the way every other task
       action already did (v1.77.0 / v1.79.0) */
    if (!r.ok) {
      const why = (r.data as { error?: { message?: string } } | undefined)?.error?.message;
      showTaskToast(L("Not created", "Tidak dibuat"), why ?? L("The task did not reach the server — try again", "Tugasan itu tidak sampai ke pelayan — cuba lagi"), "notice");
      return;
    }
    showTaskToast(r.queued ? L("Kept — no signal", "Disimpan — tiada isyarat") : L("Task created", "Tugasan dibuat"),
      r.queued ? L("Saved on this phone. It will be sent the moment you are back online.", "Disimpan pada telefon ini. Ia akan dihantar sebaik sahaja anda kembali dalam talian.")
        : L(`"${draft.title}" is on the board.`, `"${draft.title}" ada pada papan.`), r.queued ? "notice" : undefined);
    setDraft({
      title: "",
      description: "",
      scope: "",
      assigned_to: 0,
      priority: "normal",
      start_date: "",
      deadline: "",
      quotation_id: 0,
    });
    setCreateOpen(false);
    void load();
  };
  const openChecklist = async (id: number) => {
    setEditing(null);
    setOpenTask(id); setItems(null);
    const r = await api<{ items: TaskItem[] }>(`/staff/tasks/${id}/items`);
    if (r.ok && r.data) setItems(r.data.items ?? []);
  };
  const closeDetail = () => { setOpenTask(null); setItems(null); setEditing(null); setSheetFor(null); };
  const toggleItem = async (taskId: number, itemId: number) => {
    const r = await api<{ done: number; progress: number }>(
      `/staff/tasks/${taskId}/items/${itemId}/toggle`,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (r.queued) {
      /* v1.105.0 - the tick is kept on the phone and will land when the
         signal is back; until then the box cannot move, so say why. */
      showTaskToast(L("Kept — no signal", "Disimpan — tiada isyarat"),
        L("The tick is saved on this phone and will be sent when you are back online.", "Tanda disimpan pada telefon ini dan akan dihantar apabila anda kembali dalam talian."), "notice");
    } else if (r.ok) {
      const rr = await api<{ items: TaskItem[] }>(`/staff/tasks/${taskId}/items`);
      if (rr.ok && rr.data) setItems(rr.data.items ?? []);
      void load();
    } else {
      /* v1.78.0 — a tick that does not save used to do nothing at all: the
         box simply stayed as it was, which reads as "I mis-clicked" rather
         than "the server refused". Success needs no toast — the tick moving
         IS the receipt — but a refusal has no other tell. */
      showTaskToast(
        L("Not saved", "Tidak disimpan"),
        L("That tick did not reach the server — try again", "Tanda itu tidak sampai ke pelayan — cuba lagi"),
        "notice",
      );
    }
  };
  const acknowledge = async (id: number) => {
    await api(`/staff/tasks/${id}/ack`, { method: "POST", body: JSON.stringify({}) });
    void load();
  };
  /* v1.79.0 (CEO: "when I clicked closed it doesnt popup which is not
     correct!") — THIS is the dropdown, the one whose third option is
     literally "Closed". It PATCHed the task and said nothing either way, so
     closing a task looked identical to a refused request, and the only tell
     was the reload putting the old value back a second later. Guard #25's
     new rule 3 walks controls, not just buttons, and found it. */
  const update = async (id: number, patch: Record<string, unknown>): Promise<boolean> => {
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const st = typeof patch.status === "string" ? patch.status : "";
    if (r.queued) {
      /* v1.105.0 - kept on the phone; the board will show it once sent */
      showTaskToast(L("Kept — no signal", "Disimpan — tiada isyarat"),
        L("Saved on this phone. It will be sent the moment you are back online.", "Disimpan pada telefon ini. Ia akan dihantar sebaik sahaja anda kembali dalam talian."), "notice");
    } else if (r.ok) {
      showTaskToast(
        st === "completed" ? L("Task closed", "Tugasan ditutup")
          : st === "in_progress" ? L("Marked pending", "Ditanda belum selesai")
          : st === "open" ? L("Re-opened", "Dibuka semula")
          : L("Task updated", "Tugasan dikemas kini"),
        L("Saved", "Disimpan"),
      );
    } else {
      showTaskToast(
        L("Not saved", "Tidak disimpan"),
        r.data?.error?.message ?? L("That change did not reach the server — try again", "Perubahan itu tidak sampai ke pelayan — cuba lagi"),
        "notice",
      );
    }
    void load();
    return r.ok;
  };
  /* v1.72.0 (CEO: "I want to have an option for me to delete which is roles
     CEO only") — the button is CEO-only here AND the route refuses everyone
     else, so a hand-made request gets the same answer as a hidden button.
     The confirm names the task and says what leaves with it: closing a task
     is the reversible act, this one is not. */
  const canDelete = holds("task_delete", ["ceo", "super_admin"].includes(user.role));
  /* v1.245.0 - Tasks > Projects: the project briefs (one per quotation) and their tasks */
  const canProjects = canViewProjects(user.role); // v1.279.0 - one rule with the rail's Projects shortcut (lib/caps.ts)
  const remove = async (t: Task) => {
    if (
      !(await askDelete({
        title: L("Delete this task?", "Padam tugasan ini?"),
        message: L(
          `"${t.title}" goes for good, and so does everything on it — the scope checklist, the comments, the acknowledgement, and any days already booked for it on the roster. To simply end a task, set it to Closed instead.`,
          `"${t.title}" akan hilang terus, berserta segalanya padanya — senarai skop, komen, pengakuan terima, dan mana-mana hari yang telah ditempah untuknya pada roster. Untuk menamatkan tugasan sahaja, tetapkan kepada Selesai.`
        ),
        confirmLabel: L("Delete task", "Padam tugasan"),
        variant: "danger",
      }))
    )
      return;
    const res = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}`, { method: "DELETE" });
    /* v1.77.0 (CEO: "there is no popup box to show if there is any task
       successfully deleted") — a destructive action that says nothing leaves
       the person unsure whether it happened, and the row vanishing could just
       as easily be a filter. Both outcomes are now spoken. */
    if (!res.ok) {
      showTaskToast(L("Not deleted", "Tidak dipadam"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showTaskToast(L("Task deleted", "Tugasan dipadam"),
      L(`"${t.title}" and everything on it is gone.`, `"${t.title}" dan segalanya padanya telah hilang.`));
    if (openTask === t.id) closeDetail();
    void load();
  };

  /* ---- one task's facts, by the rules the list has always used ---- */
  const isOverdue = (t: Task) => !!t.deadline && t.deadline < todayISO && t.status !== "completed";
  /* v1.246.0 (T-8) - no progress report for 3 days on a task with a due
     date, 7 without: counted from the latest update, or from when it was set */
  const daysSince = (v: string) => Math.floor((Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${v.slice(0, 10)}T00:00:00Z`)) / 86400000);
  const isStale = (t: Task) => t.status !== "completed" && daysSince(t.latest_update?.at ?? t.created_at ?? todayISO) >= (t.deadline ? 3 : 7);
  const stageChip = (t: Task) => t.stage && t.status !== "completed" ? <StateChip status={t.status} stage={t.stage} /> : t.stage === "cancelled" ? <StateChip status={t.status} stage={t.stage} /> : null;
  /* the latest PROGRESS report - text, who, when; never a comment (T-1) */
  const latestCell = (t: Task) => t.latest_update ? (
    <span className={tk.latest}>
      <span className={tk.latestText}>{t.latest_update.body}</span>
      <span className={tk.muted}>{t.latest_update.by ?? ""} · {stamp(t.latest_update.at)}</span>
    </span>
  ) : <span className={isStale(t) || isOverdue(t) ? tk.warnText : tk.muted}>{L("No progress report yet", "Belum ada laporan kemajuan")}</span>;
  const isMine = (t: Task) => t.assigned_to === undefined || t.assigned_to === user.id;
  const isAssigned = (t: Task) => t.created_by != null && t.assigned_to != null && t.created_by !== t.assigned_to;
  const unacked = (t: Task) => isAssigned(t) && t.acknowledged === 0 && t.status !== "completed";

  /* v1.256.0 (TASK-CLOSURE-AUDIT D4) - the status dropdown on cards, rows and
     the drawer footer is gone: it was a second way to close and reopen,
     with no summary, no checklist check and no reason. Each place shows the
     status and opens the ONE Add Status Update form inside the task. */
  const statusSelect = (t: Task) => (
    <span className={tk.statusCell}>
      <StateChip status={t.status} stage={t.stage ?? null} />
      {t.status === "completed" && t.closed_at ? <span className={tk.muted}>{day(t.closed_at)}{t.closed_late_days ? L(` · ${t.closed_late_days}d late`, ` · lewat ${t.closed_late_days}h`) : ""}</span> : null}
      {t.status !== "completed" && <button type="button" className={btnSm} aria-label={`${L("Update status", "Kemas kini status")} — ${t.title}`} onClick={() => { setSheetFor(t.id); void openChecklist(t.id); }}>{L("Update", "Kemas kini")}</button>}
    </span>
  );
  const ackControl = (t: Task) => unacked(t) ? (
    isMine(t) ? (
      <button
        type="button"
        className={`${chipWarn} ${tk.chipBtn}`}
        onClick={() => void acknowledge(t.id)}
        title={L("Confirm you have seen and understood this task — your assigner is notified", "Sahkan anda telah melihat dan memahami tugasan ini — pemberi tugasan dimaklumkan")}
      >
        {L("Acknowledge", "Akui terima")}
      </button>
    ) : (
      <span className={chipWarn}>{L("Not acknowledged", "Belum diakui")}</span>
    )
  ) : null;
  /* v1.223.0 (Weekly Sales): a sales task names what it is about - the same
     task in Tasks and in Sales, never a copy */
  const linkChip = (t: Task) => t.link_kind === "project" && t.link_id ? (
    <button type="button" className={`${chipInfo} ${tk.projChip}`} title={L("Open the project", "Buka projek")}
      onClick={(e) => { e.stopPropagation(); setProjOpen(t.link_id ?? null); go("projects"); }}>{/* v1.247.1 - the project's name, not its number */}{t.link_label ? projName(t.link_label) : `${L("Project", "Projek")} #${t.link_id}`}</button>
  ) : t.link_kind && t.link_id ? (
    <span className={chipInfo}>{({ customer: L("Customer", "Pelanggan"), enquiry: L("Enquiry", "Pertanyaan"), quotation: L("Quotation", "Sebut harga"), recovery: L("Recovery plan", "Pelan pemulihan"), advisory: L("Sales advice", "Nasihat jualan") } as Record<string, string>)[t.link_kind] ?? t.link_kind}{t.link_kind === "advisory" ? "" : ` #${t.link_id}`}</span>
  ) : null;
  const scopeChip = (t: Task) => (t.item_count ?? 0) > 0 ? (
    <button
      type="button"
      className={`${chipNeutral} ${tk.chipBtn}`}
      title={L("Open the task and its checklist", "Buka tugasan dan senarai semaknya")}
      onClick={() => void openChecklist(t.id)}
    >
      ✓ {t.item_done ?? 0}/{t.item_count} {L("scope", "skop")}
    </button>
  ) : null;
  const deleteBtn = (t: Task) => canDelete ? (
    <button
      type="button"
      className={tk.deleteBtn}
      title={L("Delete this task (CEO only)", "Padam tugasan ini (CEO sahaja)")}
      aria-label={L("Delete task", "Padam tugasan")}
      onClick={() => void remove(t)}
    >
      <AppIcon name="error" />
    </button>
  ) : null;
  const progressBar = (t: Task) => (
    <span className={tk.progress}>
      <span className={tk.track} aria-hidden><span className={`${tk.fill} ${t.status === "completed" ? tk.fillDone : ""}`} style={{ width: `${Math.max(0, Math.min(100, t.progress))}%` }} /></span>
      <span className={tk.pct}>{t.progress}%</span>
    </span>
  );
  /* v1.246.2 - the checklist is edited, not only ticked: add, rename, remove
     (the assignee, the person who set the task, or a manager, while open) */
  const reloadItems = async (taskId: number) => {
    const rr = await api<{ items: TaskItem[] }>(`/staff/tasks/${taskId}/items`);
    if (rr.ok && rr.data) setItems(rr.data.items ?? []);
    void load();
  };
  const itemFail = (r: { data?: unknown }, fallback: string) =>
    showTaskToast(L("Not saved", "Tidak disimpan"), (r.data as { error?: { message?: string } } | undefined)?.error?.message ?? fallback, "notice");
  const addItem = async (t: Task) => {
    const title = newItem.trim();
    if (title.length < 2) return;
    const r = await api(`/staff/tasks/${t.id}/items`, { method: "POST", body: JSON.stringify({ title }) });
    if (!r.ok) { itemFail(r, L("The deliverable was not added", "Hasil kerja tidak ditambah")); return; }
    setNewItem("");
    showTaskToast(L("Deliverable added", "Hasil kerja ditambah"), title);
    await reloadItems(t.id);
  };
  const renameItem = async (t: Task) => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (title.length < 2) return;
    const r = await api(`/staff/tasks/${t.id}/items/${renaming.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    if (!r.ok) { itemFail(r, L("The deliverable was not renamed", "Hasil kerja tidak dinamakan semula")); return; }
    setRenaming(null);
    await reloadItems(t.id);
  };
  const removeItem = async (t: Task, it: TaskItem) => {
    const go = await askDelete({
      title: L("Remove this deliverable?", "Buang hasil kerja ini?"),
      message: it.done ? L(`"${it.title}" is already ticked. Removing it changes the task's progress; the tick stays in the activity.`, `"${it.title}" sudah ditanda. Membuangnya mengubah kemajuan tugasan; tanda itu kekal dalam aktiviti.`) : it.title,
      confirmLabel: L("Remove", "Buang"),
    });
    if (!go) return;
    const r = await api(`/staff/tasks/${t.id}/items/${it.id}`, { method: "DELETE" });
    if (!r.ok) { itemFail(r, L("The deliverable was not removed", "Hasil kerja tidak dibuang")); return; }
    showTaskToast(L("Deliverable removed", "Hasil kerja dibuang"), it.title);
    await reloadItems(t.id);
  };
  const checklist = (t: Task) => {
    const mine = isMine(t);
    const editable = (mine || canManage || t.created_by === user.id) && t.status !== "completed";
    return (
      <div className={tk.checklist}>
        {/* v1.77.0 — skeleton until the first fetch lands: two
            checklist lines, the shape of the scope items. */}
        {!items && (
          <div className={tk.skelList} aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className={tk.skelLine}>
                <Skel className="h-4 w-4 shrink-0" />
                <Skel className={`h-3.5 ${i === 0 ? "w-2/3" : "w-1/2"}`} />
              </div>
            ))}
          </div>
        )}
        {items && items.length === 0 && (
          <p className={tk.muted}>{L("No scope items on this task.", "Tiada item skop pada tugasan ini.")}</p>
        )}
        {items && items.map((it) => renaming?.id === it.id ? (
          <form key={it.id} className={tk.itemEdit} onSubmit={(e) => { e.preventDefault(); void renameItem(t); }}>
            <input className={inputClassSm} value={renaming.title} aria-label={L("Deliverable", "Hasil kerja")} autoFocus maxLength={200}
              onChange={(e) => setRenaming({ id: it.id, title: e.target.value })} />
            <button type="submit" className={btnSm} disabled={renaming.title.trim().length < 2}>{L("Save", "Simpan")}</button>
            <button type="button" className={btnSm} onClick={() => setRenaming(null)}>{L("Cancel", "Batal")}</button>
          </form>
        ) : (
          <div key={it.id} className={tk.item}>
            <input
              type="checkbox"
              aria-label={it.title}
              checked={it.done === 1}
              disabled={!mine && !canManage}
              onChange={() => void toggleItem(t.id, it.id)}
            />
            <span className={`${tk.itemText} ${it.done ? tk.itemDone : ""}`}>
              {it.title}
              {it.done === 1 && it.done_by_name ? (
                <span className={tk.itemBy}>
                  — {it.done_by_name}{it.done_at ? ` · ${it.done_at.slice(0, 10)}` : ""}
                </span>
              ) : null}
            </span>
            {editable && (
              <span className={tk.itemCmds}>
                <button type="button" className={tk.itemBtn} aria-label={L(`Rename "${it.title}"`, `Namakan semula "${it.title}"`)} title={L("Rename", "Namakan semula")} onClick={() => setRenaming({ id: it.id, title: it.title })}><AppIcon name="edit" /></button>
                <button type="button" className={`${tk.itemBtn} ${tk.itemBtnDanger}`} aria-label={L(`Remove "${it.title}"`, `Buang "${it.title}"`)} title={L("Remove", "Buang")} onClick={() => void removeItem(t, it)}>×</button>
              </span>
            )}
          </div>
        ))}
        {items && editable && (
          <form className={tk.itemAdd} onSubmit={(e) => { e.preventDefault(); void addItem(t); }} data-testid="item-add">
            <input className={inputClassSm} value={newItem} maxLength={200} placeholder={L("Add a deliverable…", "Tambah hasil kerja…")} aria-label={L("Add a deliverable", "Tambah hasil kerja")}
              onChange={(e) => setNewItem(e.target.value)} />
            <button type="submit" className={btnSm} disabled={newItem.trim().length < 2}><AppIcon name="add" />{L("Add", "Tambah")}</button>
          </form>
        )}
      </div>
    );
  };

  /* ---- the toolbar every list shares ---- */
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<StatusF>("active");
  const [prioF, setPrioF] = useState("");
  const [whoF, setWhoF] = useState<number>(0);
  const [aboutF, setAboutF] = useState(""); // v1.246.0 - project / customer
  const [sortK, setSortK] = useState<SortK>("newest");
  const [mineMode, setMineMode] = useState<"list" | "board">("list");
  const [allMode, setAllMode] = useState<"list" | "board">("list");
  const [allPage, setAllPage] = useState(1);
  const [pickedTask, setPickedTask] = useState<number | null>(null); // v1.313.0 - the task shown beside My Tasks
  const [archPage, setArchPage] = useState(1);
  /* the Calendar's month, Malaysia time */
  const [calMonth, setCalMonth] = useState(() => todayISO.slice(0, 7));
  /* v1.250.1 (the owner, 01-11-2026: "the project task was not included into the
     calendar deadline") - a PROJECT's own due date belongs on the Deadlines
     calendar beside its tasks. Read from the same list Tasks > Projects shows
     (the CEO, COO, CCO: every project; anyone else: the projects they own or
     have a task on). Nothing is written. */
  type CalProject = { id: number; title: string; company: string | null; due_date: string | null; status: string; doc_number?: string | null };
  const [calProjects, setCalProjects] = useState<CalProject[] | null>(null);
  /* a person's position, from the picker list the form already reads */
  const positionOf = (id?: number) => {
    const u = id == null ? undefined : team.find((x) => x.id === id);
    return u ? (u.position || (u.role ?? "").replace(/_/g, " ")) : "";
  };
  const [archQ, setArchQ] = useState("");
  const [older, setOlder] = useState<Task[]>([]);
  const [olderNext, setOlderNext] = useState<number | null>(null); // null = not asked yet, 0 = no more
  const [olderBusy, setOlderBusy] = useState(false);
  const needle = q.trim().toLowerCase();
  const sift = (rows: Task[], opts: { status?: boolean; who?: boolean } = {}) => rows
    .filter((t) => !opts.status ? true
      : statusF === "any" ? true : statusF === "active" ? t.status !== "completed"
      /* v1.246.0 - the stage filters, the overdue and quiet ones, and the
         tasks I help on or set for somebody else */
      : statusF === "review" || statusF === "blocked" || statusF === "waiting_client" ? t.status !== "completed" && t.stage === statusF
      : statusF === "overdue" ? isOverdue(t)
      : statusF === "stale" ? isStale(t)
      : statusF === "assisting" ? (t.assistants ?? []).some((a) => a.id === user.id)
      : statusF === "set_by_me" ? t.created_by === user.id && t.assigned_to !== user.id
      : t.status === statusF)
    .filter((t) => !aboutF || t.link_label === aboutF)
    .filter((t) => !prioF || t.priority === prioF)
    .filter((t) => !opts.who || !whoF || t.assigned_to === whoF)
    .filter((t) => !needle || [t.title, t.description ?? "", t.assignee ?? ""].some((x) => x.toLowerCase().includes(needle)))
    .sort((a, b) => {
      switch (sortK) {
        case "deadline": return (a.deadline || "9999").localeCompare(b.deadline || "9999");
        case "priority": return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
        case "title": return a.title.localeCompare(b.title);
        case "progress": return b.progress - a.progress;
        default: return 0; // the server's order: newest first
      }
    });
  const filtering = !!(needle || prioF || whoF || aboutF || statusF !== "active");
  const clearFilters = () => { setQ(""); setPrioF(""); setWhoF(0); setAboutF(""); setStatusF("active"); setSortK("newest"); setAllPage(1); };
  const abouts = useMemo(() => [...new Set(tasks.map((t) => t.link_label).filter((x): x is string => !!x))].sort(), [tasks]);
  const toolbar = (withWho: boolean, withStatus = true) => (
    <div className={tk.toolbar} role="search">
      <label className={tk.search}>
        <AppIcon name="search" />
        <input type="search" value={q} aria-label={L("Search tasks", "Cari tugasan")}
          placeholder={withWho ? L("Search title, description or staff…", "Cari tajuk, keterangan atau kakitangan…") : L("Search title or description…", "Cari tajuk atau keterangan…")}
          onChange={(e) => { setQ(e.target.value); setAllPage(1); }} />
      </label>
      {withStatus && (
        <select className={inputClassSm} aria-label={L("Status", "Status")} value={statusF} onChange={(e) => { setStatusF(e.target.value as StatusF); setAllPage(1); }}>
          <option value="active">{L("Active (open + in progress)", "Aktif (terbuka + sedang dibuat)")}</option>
          <option value="open">{L("Open", "Terbuka")}</option>
          <option value="in_progress">{L("In progress", "Sedang dibuat")}</option>
          <option value="completed">{L("Closed", "Selesai")}</option>
          <option value="review">{L("Waiting for review", "Menunggu semakan")}</option>
          <option value="blocked">{L("Blocked", "Terhalang")}</option>
          <option value="waiting_client">{L("Waiting for client", "Menunggu pelanggan")}</option>
          <option value="overdue">{L("Overdue", "Lewat")}</option>
          <option value="stale">{L("No recent update", "Tiada kemas kini terkini")}</option>
          <option value="assisting">{L("I am helping on", "Saya membantu")}</option>
          <option value="set_by_me">{L("Set by me", "Ditetapkan oleh saya")}</option>
          <option value="any">{L("All statuses", "Semua status")}</option>
        </select>
      )}
      {abouts.length > 0 && (
        <select className={inputClassSm} aria-label={L("Project or customer", "Projek atau pelanggan")} value={aboutF} onChange={(e) => { setAboutF(e.target.value); setAllPage(1); }}>
          <option value="">{L("All projects and customers", "Semua projek dan pelanggan")}</option>
          {abouts.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      <select className={inputClassSm} aria-label={L("Priority", "Keutamaan")} value={prioF} onChange={(e) => { setPrioF(e.target.value); setAllPage(1); }}>
        <option value="">{L("All priorities", "Semua keutamaan")}</option>
        {["urgent", "high", "normal", "low"].map((p) => <option key={p} value={p}>{priorityL(p)}</option>)}
      </select>
      {withWho && (
        <select className={inputClassSm} aria-label={L("Assigned to", "Diberikan kepada")} value={whoF} onChange={(e) => { setWhoF(Number(e.target.value)); setAllPage(1); }}>
          <option value={0}>{L("Everyone", "Semua orang")}</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <select className={inputClassSm} aria-label={L("Sort", "Isih")} value={sortK} onChange={(e) => setSortK(e.target.value as SortK)}>
        <option value="newest">{L("Newest first", "Terbaru dahulu")}</option>
        <option value="deadline">{L("Deadline, soonest", "Tarikh akhir, terdekat")}</option>
        <option value="priority">{L("Priority, highest", "Keutamaan, tertinggi")}</option>
        <option value="progress">{L("Progress, most done", "Kemajuan, paling siap")}</option>
        <option value="title">{L("Title, A–Z", "Tajuk, A–Z")}</option>
      </select>
      {filtering && <button type="button" className={btnSm} onClick={clearFilters}>{L("Clear", "Kosongkan")}</button>}
    </div>
  );

  /* ---- THE TASK TABLE: every row carries the controls the list always had ---- */
  const renderTasks = (rows: Task[], title: string, pending = false, opts: { who?: boolean; dept?: boolean; edit?: boolean; select?: { id: number | null; set: (id: number) => void }; empty?: ReactNode; sub?: ReactNode; tools?: ReactNode; id?: string; pager?: { page: number; set: (n: number) => void } } = {}) => {
    /* v1.209.0 - a page of PER rows at a time where the list is long; the
       count above is still every matching row */
    const pages = opts.pager ? Math.max(1, Math.ceil(rows.length / PER)) : 1;
    const page = opts.pager ? Math.min(opts.pager.page, pages) : 1;
    const shown = opts.pager ? rows.slice((page - 1) * PER, page * PER) : rows;
    return (
    <div className={card} id={opts.id}>
      <div className={tk.head}>
        <div className={tk.headText}>
          <p className={tk.title}>{title}</p>
          {opts.sub && <p className={tk.sub}>{opts.sub}</p>}
        </div>
        {!pending && <span className={tk.count}>{rows.length}</span>}
      </div>
      {opts.tools}
      {/* v1.77.0 — skeleton until the first fetch lands. */}
      {pending && <SkelRows rows={5} className="max-h-96" />}
      {!pending && rows.length === 0 && (opts.empty ?? (
        <p className={tk.empty}><AppIcon name="success" />{L("No tasks.", "Tiada tugasan.")}</p>
      ))}
      {!pending && rows.length > 0 && (
        /* v1.176.1 - the page scrolls this list, not a 384px window inside it. */
        <div className={`erp-table-scroll erp-mt-2 ${tk.tableWrap}`}>
          <table className={`${tk.table} ${tk.tight}`} aria-label={title}>
            <thead>
              <tr>
                <th>{L("Task & Context", "Tugasan & Konteks")}</th>
                <th>{L("Status", "Status")}</th>
                <th>{L("Priority", "Keutamaan")}</th>
                <th>{L("Due Date", "Tarikh Akhir")}</th>
                <th>{L("Assignee", "Penerima")}</th>
                {opts.dept && <th>{L("Department", "Jabatan")}</th>}
                <th>{L("Progress", "Kemajuan")}</th>
                <th>{L("Subtasks", "Subtugasan")}</th>
                <th>{L("Actions", "Tindakan")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                /* v1.42.0: the list is a monitoring surface — an overdue task is
                   RED before anyone reads a date, an unacknowledged assignment
                   wears an amber badge, and the scope tally shows how far along
                   the work actually is. v1.313.0 (image 1/3) - the board's
                   columns; a row chosen on My Tasks is the one shown beside it. */
                const overdue = isOverdue(t);
                const picked = opts.select && opts.select.id === t.id;
                const editable = (isMine(t) || canManage) && t.status !== "completed";
                return (
                  <tr key={t.id} data-record={`task:${t.id}`} className={`${overdue ? tk.rowOverdue : ""} ${picked ? tk.rowPicked : ""}`}
                    onClick={opts.select ? () => opts.select!.set(t.id) : undefined} aria-selected={opts.select ? Boolean(picked) : undefined}>
                    <td className={tk.taskCell} data-label={L("Task", "Tugasan")}>
                      <button type="button" className={`${tk.taskTitle} ${tk.titleBtn} ${overdue ? tk.danger : ""}`} onClick={() => void openChecklist(t.id)}>{t.title}</button>
                      {/* v1.152.2 (the CEO's kept-lines sweep): the description was
                          typed, saved, and shown NOWHERE - the row listed everything
                          about a task except what it said. Its lines are kept. */}
                      {t.description && (
                        <p className={`${tk.descLine} whitespace-pre-line`}>{t.description}</p>
                      )}
                      <span className={tk.badges}>{stageChip(t)}{linkChip(t)}{ackControl(t)}</span>
                      {/* the latest meaningful update (directive s5) - a progress report, never a comment */}
                      <span className={tk.latestLine}>{latestCell(t)}</span>
                    </td>
                    <td data-label={L("Status", "Status")}><StateChip status={t.status} stage={t.stage ?? null} />{t.status === "completed" && t.closed_at ? <span className={tk.muted}> {day(t.closed_at)}</span> : null}</td>
                    <td data-label={L("Priority", "Keutamaan")}><span className={PRIO_CHIP_5[t.priority] ?? chipNeutral}>{prioWord(t.priority)}</span></td>
                    <td data-label={L("Due Date", "Tarikh Akhir")}>
                      {/* v1.248.0 - start to due; the due date says when it is overdue. */}
                      <div className={tk.dates} title={t.start_date ? L(`From ${dmy(t.start_date)}`, `Dari ${dmy(t.start_date)}`) : undefined}>
                        {t.deadline
                          ? <span className={overdue ? tk.danger : ""}>{shortDate(t.deadline)}</span>
                          : <span className={tk.muted}>—</span>}
                        {overdue && <span className={`${tk.danger} ${tk.small}`}>{L("Overdue", "Lewat")}</span>}
                      </div>
                    </td>
                    <td data-label={L("Assignee", "Penerima")}>
                      {t.assignee ? <span className={tk.who}><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}</span></span> : <span className={tk.muted}>—</span>}
                    </td>
                    {opts.dept && <td data-label={L("Department", "Jabatan")} className={tk.cap}>{deptOf(t.assigned_to) ? <span className={chipNeutral}>{deptOf(t.assigned_to)}</span> : <span className={tk.muted}>—</span>}</td>}
                    <td data-label={L("Progress", "Kemajuan")}>{progressBar(t)}</td>
                    <td data-label={L("Subtasks", "Subtugasan")}>{(t.item_count ?? 0) > 0 ? scopeChip(t) : <span className={tk.muted}>—</span>}</td>
                    <td data-label={L("Actions", "Tindakan")} className={tk.delCell}>
                      <span className={tk.rowActs}>
                        {opts.edit && editable && (
                          <button type="button" className={btnSm} aria-label={`${L("Edit", "Sunting")} — ${t.title}`} data-testid="row-edit"
                            onClick={(e) => { e.stopPropagation(); void openChecklist(t.id); setEditing({ title: t.title, description: t.description ?? "", priority: t.priority, start_date: t.start_date ?? "", deadline: t.deadline ?? "", assigned_to: t.assigned_to ?? 0 }); }}>
                            <AppIcon name="edit" />{L("Edit", "Sunting")}
                          </button>
                        )}
                        {t.status !== "completed" && <button type="button" className={btnSm} aria-label={`${L("Update status", "Kemas kini status")} — ${t.title}`} onClick={(e) => { e.stopPropagation(); setSheetFor(t.id); void openChecklist(t.id); }}>{L("Update", "Kemas kini")}</button>}
                        <button type="button" className={btnSm} aria-label={`${L("Open", "Buka")} — ${t.title}`} onClick={(e) => { e.stopPropagation(); void openChecklist(t.id); }}>⋯</button>
                        {deleteBtn(t)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {opts.pager && !pending && rows.length > PER && (
        <nav className={tk.pager} aria-label={L(`${title} pages`, `Halaman ${title}`)}>
          <span className={tk.muted}>{L(`Showing ${(page - 1) * PER + 1} to ${Math.min(page * PER, rows.length)} of ${rows.length}`, `Menunjukkan ${(page - 1) * PER + 1} hingga ${Math.min(page * PER, rows.length)} daripada ${rows.length}`)}</span>
          <span className={tk.pagerBtns}>
            <button type="button" className={btnSm} disabled={page <= 1} aria-label={L("Previous page", "Halaman sebelum")} onClick={() => opts.pager!.set(page - 1)}><AppIcon name="previous" /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className={`${btnSm} ${n === page ? tk.pageOn : ""}`} aria-current={n === page ? "page" : undefined} onClick={() => opts.pager!.set(n)}>{n}</button>
            ))}
            <button type="button" className={btnSm} disabled={page >= pages} aria-label={L("Next page", "Halaman seterusnya")} onClick={() => opts.pager!.set(page + 1)}><AppIcon name="next" /></button>
          </span>
        </nav>
      )}
    </div>
    );
  };

  /* ---- a Board of your own work: the three statuses the dropdown has ---- */
  const renderBoard = (rows: Task[], limit = 0) => (
    <div className={tk.board}>
      {(["open", "in_progress", "completed"] as const).map((st) => {
        const all = rows.filter((t) => t.status === st);
        const col = limit ? all.slice(0, limit) : all;
        return (
          <section key={st} className={tk.col} aria-label={statusL(st)}>
            <p className={tk.colHead}><span className={`${tk.dot} ${st === "open" ? tk.dotOpen : st === "in_progress" ? tk.dotPending : tk.dotDone}`} />{statusL(st)}<span className={tk.count}>{all.length}</span></p>
            {col.length === 0 ? <p className={tk.colEmpty}>{L("Nothing here.", "Tiada apa-apa di sini.")}</p> : col.map((t) => (
              <article key={t.id} data-record={`task:${t.id}`} className={`${tk.cardItem} ${isOverdue(t) ? tk.cardOverdue : ""}`}>
                <button type="button" className={`${tk.taskTitle} ${tk.titleBtn} ${isOverdue(t) ? tk.danger : ""}`} onClick={() => void openChecklist(t.id)}>{t.title}</button>
                {t.assignee && canManage && <span className={tk.muted}>{t.assignee}</span>}
                <span className={tk.badges}>
                  <span className={`${PRIORITY_CHIP[t.priority] ?? chipNeutral} ${tk.cap}`}>{priorityL(t.priority)}</span>
                  {t.deadline && <span className={isOverdue(t) ? chipDanger : chipNeutral}>{t.start_date ? `${dmy(t.start_date)} → ` : ""}{isOverdue(t) ? L(`was due ${dmy(t.deadline)}`, `sepatutnya ${dmy(t.deadline)}`) : dmy(t.deadline)}</span>}
                  {linkChip(t)}{scopeChip(t)}{ackControl(t)}
                </span>
                {progressBar(t)}
                <span className={tk.cardFoot}>{statusSelect(t)}{deleteBtn(t)}</span>
              </article>
            ))}
            {limit > 0 && all.length > col.length && <p className={tk.colEmpty}>{L(`and ${all.length - col.length} more`, `dan ${all.length - col.length} lagi`)}</p>}
          </section>
        );
      })}
    </div>
  );

  /* v1.173.0 (tab concept) - the summary tier: the board's own figures,
     derived from the rows already loaded, never a second request. Open and
     overdue read from the same rule the list paints red with (v1.42.0). */
  /* v1.203.0 - the four figures come from lib/task-figures.ts, which the
     Dashboard's Task Overview reads too */
  const { openTasks, overdueCount, pendingCount } = taskFigures(tasks, todayISO);

  /* v1.246.0 - My Tasks: what I do, and what I help on (an assistant never
     replaces the person responsible - the row still names them) */
  const myTasks = tasks.filter((t) => isMine(t) || (t.assistants ?? []).some((a) => a.id === user.id));
  const myActive = myTasks.filter((t) => t.status !== "completed");
  const closed = tasks.filter((t) => t.status === "completed");
  const loadOlder = async () => {
    if (olderBusy) return;
    setOlderBusy(true);
    const before = olderNext ?? Math.min(...closed.map((t) => t.id), ...older.map((t) => t.id));
    const qs = Number.isFinite(before) ? `&before=${before}` : "";
    const r = await api<{ tasks: Task[]; next_before: number | null }>(`/staff/tasks?archive=1${canManage ? "&all=1" : ""}${qs}`);
    setOlderBusy(false);
    if (r.ok && r.data) { setOlder((o) => [...o, ...r.data!.tasks]); setOlderNext(r.data.next_before ?? 0); }
  };
  const archNeedle = archQ.trim().toLowerCase();
  /* the team's tallies, from the rows already loaded (managers' board) */
  const assignees = (() => {
    const m = new Map<number, { id: number; name: string; photo: string | null; role: string; open: number; pending: number; overdue: number; closed: number; total: number }>();
    for (const t of tasks) {
      if (t.assigned_to == null) continue;
      const fromRoster = team.find((u) => u.id === t.assigned_to);
      const cur = m.get(t.assigned_to) ?? { id: t.assigned_to, name: t.assignee ?? fromRoster?.name ?? `#${t.assigned_to}`, photo: t.assignee_photo ?? null, role: fromRoster?.position || (fromRoster?.role ?? "").replace(/_/g, " "), open: 0, pending: 0, overdue: 0, closed: 0, total: 0 };
      cur.total += 1;
      if (t.status === "completed") cur.closed += 1;
      else if (t.status === "in_progress") cur.pending += 1;
      else cur.open += 1;
      if (!!t.deadline && t.deadline < todayISO && t.status !== "completed") cur.overdue += 1;
      m.set(t.assigned_to, cur);
    }
    return [...m.values()].sort((a, b) => (b.total - b.closed) - (a.total - a.closed) || a.name.localeCompare(b.name));
  })();

  const head = (icon: AppIconName, tone: string | undefined, title: string, subText?: ReactNode, action?: ReactNode) => (
    <div className={tk.head}>
      <div className={tk.lead}>
        <span className={`${tk.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={tk.headText}>
          <p className={tk.title}>{title}</p>
          {subText && <p className={tk.sub}>{subText}</p>}
        </div>
      </div>
      {action}
    </div>
  );
  const caughtUp = (
    <div className={tk.caughtUp}>
      <span className={tk.caughtIcon}><AppIcon name="success" /></span>
      <p className={tk.title}>{L("No active tasks", "Tiada tugasan aktif")}</p>
      <p className={tk.sub}>{L("You're all caught up. New tasks assigned to you will appear here.", "Semua sudah selesai. Tugasan baharu yang diberikan kepada anda akan muncul di sini.")}</p>
      <button type="button" className={btnSm} onClick={() => setCreateOpen(true)}><AppIcon name="add" />{L("Create a task", "Buat tugasan")}</button>
    </div>
  );
  const openList = (t: Task) => { setQ(t.title); setStatusF("any"); go(canManage ? "all" : "mine"); };
  /* v1.205.0 - a search hit, a notification or a Desk item opens the task:
     the list narrowed to it (openList, as the overview's own rows do), its
     filters cleared, its row in view and its scope checklist open */
  const focused = useRecordFocus(focus, loaded, (f) => {
    if (f.kind === "project") { setProjOpen(f.id); setView("projects"); return; } // v1.245.0
    if (f.kind !== "task") return;
    const t = tasks.find((x) => x.id === f.id);
    if (!t) { setView(canManage ? "all" : "mine"); return; }
    setPrioF(""); setWhoF(0); setMineMode("list");
    openList(t);
    /* v1.209.0 - and the task's drawer opens on it */
    setEditing(null); setOpenTask(t.id); setItems(null);
  });
  useScrollToRecord(focused);
  const focusedTask = focused?.kind === "task" ? focused.id : null;
  useEffect(() => {
    if (focusedTask == null) return;
    void api<{ items: TaskItem[] }>(`/staff/tasks/${focusedTask}/items`).then((r) => { if (r.ok && r.data) setItems(r.data.items ?? []); });
  }, [focusedTask]);

  /* v1.313.0 - TASKS 5.0: the Overview's team exceptions and progress feed,
     the Due Soon window, the preview's chosen task and each assignee's
     department (from the staff list - the person's own record) */
  const plusMonth = (k: number) => { const [yy, mm] = todayISO.slice(0, 7).split("-").map(Number); return new Date(Date.UTC(yy!, mm! - 1 + k, 1)).toISOString().slice(0, 7); };
  const reportRows = useCachedApi<{ reports: { report_date: string }[] }>("/staff/task-reports", canTaskReports && view === "reports", ["task_reports"]);
  const reportsThisMonth = (reportRows.data?.reports ?? []).filter((r) => r.report_date.startsWith(todayISO.slice(0, 7))).length;
  const reportsLastMonth = (reportRows.data?.reports ?? []).filter((r) => r.report_date.startsWith(plusMonth(-1))).length;
  const teamAttention = openTasks.filter((t) => t.stage === "blocked" || isOverdue(t) || t.stage === "review" || unacked(t) || isStale(t))
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const plusDays = (k: number) => new Date(Date.parse(`${todayISO}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const deptOf = (id?: number) => team.find((s) => s.id === id)?.department ?? "";
  const recentProgress = (
    <section className={card} aria-label={L("Recent Progress", "Kemajuan Terkini")} data-testid="progress-overview">
      <Head5 icon="refresh" title={L("Recent Progress", "Kemajuan Terkini")} sub={L("The latest progress reports, newest first - never a comment.", "Laporan kemajuan terkini, terbaru dahulu - bukan komen.")} />
      {(() => {
        const recent = (canManage ? tasks : myTasks).filter((t) => t.latest_update).sort((a, b) => (b.latest_update!.at).localeCompare(a.latest_update!.at)).slice(0, 6);
        return recent.length === 0 ? <p className={tk.empty}><AppIcon name="info" />{L("No progress reports yet.", "Belum ada laporan kemajuan.")}</p> : (
          <ul className={tk.attn}>
            {recent.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => void openChecklist(t.id)}>
                  <span className={tk.attnText}>
                    <strong>{t.title}</strong>
                    <span className={tk.muted}>{t.latest_update!.by} · {stamp(t.latest_update!.at)} — {t.latest_update!.body.slice(0, 100)}</span>
                  </span>
                  <span className={tk.badges}><StateChip status={t.status} stage={t.stage ?? null} /></span>
                  <AppIcon name="next" />
                </button>
              </li>
            ))}
          </ul>
        );
      })()}
    </section>
  );

  const taskTabs: [TaskView, string, string][] = [
    ["overview", L("Overview", "Gambaran"), L("What needs attention now", "Apa yang perlu perhatian sekarang")],
    ["mine", L("My Tasks", "Tugasan Saya"), L("Tasks assigned to you", "Tugasan yang diberikan kepada anda")],
    ...(canManage ? [["all", L("All Tasks", "Semua Tugasan"), L("The team's task register", "Daftar tugasan pasukan")] as [TaskView, string, string]] : []),
    ...(canProjects ? [["projects", L("Projects", "Projek"), L("Delivery from accepted quotations", "Penghantaran daripada sebut harga diterima")] as [TaskView, string, string]] : []),
    ["calendar", L("Calendar", "Kalendar"), L("Deadlines, reviews, lives and milestones", "Tarikh akhir, semakan, live dan pencapaian")],
    ["reports", L("Reports & Archive", "Laporan & Arkib"), L("Operational reports and closed work", "Laporan operasi dan kerja ditutup")],
  ];
  return (
    <TabPage>
      {deleteConfirmNode}
      {taskToastNode}
      {/* v1.313.0 - TASKS 5.0: six tabs, one list for the tab row (desktop) and
          the view switch with Create Task (phone), as Finance and Commission */}
      <div className="erp-desktop-only">
      <LineTabs value={view} onChange={(k) => go(k)} label={L("Tasks", "Tugasan")} tabs={taskTabs.map(([k, t]) => [k, t] as const)} aside={
        <TabAside>
          <TabAction icon="add" onClick={() => setCreateOpen(true)}>{L("Create Task", "Buat Tugasan")}</TabAction>
        </TabAside>
      } />
      </div>
      <div className="erp-phone-only">
        <div className={tk.viewBar} data-testid="tasks-view-bar">
          <ViewSwitch value={view} onChange={(k) => go(k)} label={L("Tasks view", "Paparan tugasan")} options={taskTabs} />
          <button type="button" className={btnSmPrimary} onClick={() => setCreateOpen(true)}><AppIcon name="add" />{L("Create Task", "Buat Tugasan")}</button>
        </div>
      </div>

      {/* ============================== OVERVIEW ============================== */}
      {/* v1.313.0 - TASKS 5.0 (TK-2): only what needs attention now - four
          figures of your own work, your priority work, the team's exceptions
          (management) and the latest verified progress. Each row opens the
          task itself; nothing here is repeated from another tab. */}
      <TabZone label={L("Overview", "Gambaran")} className={view !== "overview" ? tk.off : ""}>
        <KpiRow label={L("My work", "Kerja saya")}>
          <KpiTile icon="orders" tone="blue" label={L("My Open Tasks", "Tugasan Terbuka Saya")} value={myActive.length} busy={!loaded}
            sub={L("Open and in progress, yours", "Terbuka dan sedang berjalan, milik anda")} onClick={() => { clearFilters(); go("mine"); }} />
          <KpiTile icon="pending" tone="gold" label={L("In Progress", "Sedang Berjalan")} value={myActive.filter((t) => t.status === "in_progress").length} busy={!loaded}
            sub={L("Currently being worked on", "Sedang diusahakan")} onClick={() => { clearFilters(); setStatusF("in_progress"); go("mine"); }} />
          <KpiTile icon="warning" tone="red" label={L("Overdue", "Lewat")} value={myActive.filter(isOverdue).length} busy={!loaded}
            sub={L("Past due and still open", "Lepas tarikh dan masih terbuka")} onClick={() => { clearFilters(); setStatusF("overdue"); go("mine"); }} />
          <KpiTile icon="time" tone="purple" label={L("Awaiting Review", "Menunggu Semakan")} value={(canManage ? openTasks : myActive).filter((t) => t.stage === "review").length} busy={!loaded}
            sub={canManage ? L("Submitted for review, in your scope", "Dihantar untuk semakan, dalam skop anda") : L("Yours, waiting for the reviewer", "Milik anda, menunggu penyemak")}
            onClick={() => { clearFilters(); setStatusF("review"); go(canManage ? "all" : "mine"); }} />
        </KpiRow>

        <div className={t5.splitWide}>
          <section className={card} aria-label={L("My Priority Work", "Kerja Keutamaan Saya")} data-testid="priority-work">
            <Head5 icon="target" title={L("My Priority Work", "Kerja Keutamaan Saya")} sub={L("Overdue first, then due today, then high priority, then the soonest due.", "Lewat dahulu, kemudian perlu siap hari ini, keutamaan tinggi, kemudian yang terdekat.")}
              aside={<button type="button" className={btnSm} onClick={() => { clearFilters(); setSortK("deadline"); go("mine"); }}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>} />
            {!loaded ? <SkelRows rows={4} /> : myActive.length === 0 ? caughtUp : (
              <ul className={tk.attn}>
                {byUrgency(myActive, todayISO).slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => void openChecklist(t.id)}>
                      <span className={tk.attnText}>
                        <strong className={isOverdue(t) ? tk.danger : ""}>{t.title}</strong>
                        <span className={tk.muted}>{[t.link_label ? projName(t.link_label) : null, prioWord(t.priority), t.deadline ? (isOverdue(t) ? L(`was due ${dmy(t.deadline)}`, `sepatutnya ${dmy(t.deadline)}`) : L(`due ${dmy(t.deadline)}`, `siap ${dmy(t.deadline)}`)) : null, `${t.progress}%`].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className={tk.badges}><StateChip status={t.status} stage={t.stage ?? null} />{unacked(t) && <span className={chipWarn}>{L("Not acknowledged", "Belum diakui")}</span>}</span>
                      <AppIcon name="next" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {canManage ? (
            <section className={card} aria-label={L("Team Attention", "Perhatian Pasukan")} data-testid="team-attention">
              <Head5 icon="warning" title={L("Team Attention", "Perhatian Pasukan")} sub={L("Blocked, overdue, waiting for review, not acknowledged or gone quiet - in your scope.", "Terhalang, lewat, menunggu semakan, belum diakui atau senyap - dalam skop anda.")} />
              {/* v1.246.0 kept - the counts that open the register on them */}
              <div className={tk.progressCounts}>
                <button type="button" className={tk.countBtn} onClick={() => { clearFilters(); setStatusF("blocked"); go("all"); }}><strong>{openTasks.filter((t) => t.stage === "blocked").length}</strong>{L("Blocked", "Terhalang")}</button>
                <button type="button" className={tk.countBtn} onClick={() => { clearFilters(); setStatusF("overdue"); go("all"); }}><strong>{overdueCount}</strong>{L("Overdue", "Lewat")}</button>
                <button type="button" className={tk.countBtn} onClick={() => { clearFilters(); setStatusF("review"); go("all"); }}><strong>{openTasks.filter((t) => t.stage === "review").length}</strong>{L("Waiting for review", "Menunggu semakan")}</button>
                <button type="button" className={tk.countBtn} onClick={() => { clearFilters(); setStatusF("stale"); go("all"); }}><strong>{openTasks.filter(isStale).length}</strong>{L("No recent update", "Tiada kemas kini terkini")}</button>
              </div>
              {!loaded ? <SkelRows rows={3} /> : teamAttention.length === 0 ? (
                <p className={tk.empty}><AppIcon name="success" />{L("Nothing needs attention.", "Tiada yang perlu perhatian.")}</p>
              ) : (
                <ul className={tk.attn}>
                  {teamAttention.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => void openChecklist(t.id)}>
                        <span className={tk.attnText}>
                          <strong>{t.title}</strong>
                          <span className={tk.muted}>{t.assignee ?? ""}{t.deadline ? ` · ${L("due", "sebelum")} ${dmy(t.deadline)}` : ""}</span>
                        </span>
                        <span className={tk.badges}>
                          {t.stage === "blocked" && <span className={chipDanger}>{L("Blocked", "Terhalang")}</span>}
                          {isOverdue(t) && <span className={chipDanger}>{L("Overdue", "Lewat")}</span>}
                          {t.stage === "review" && <span className={chipWarn}>{L("Review", "Semakan")}</span>}
                          {unacked(t) && <span className={chipWarn}>{L("Not acknowledged", "Belum diakui")}</span>}
                          {isStale(t) && !isOverdue(t) && <span className={chipNeutral}>{L("No recent update", "Tiada kemas kini terkini")}</span>}
                        </span>
                        <AppIcon name="next" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : recentProgress}
        </div>
        {canManage && recentProgress}
      </TabZone>

      {/* ============================== MY TASKS ============================== */}
      {/* v1.313.0 - TASKS 5.0 (image 1): four figures of your own work, the
          one list (List or Board) with the selected task beside it from
          1280px, and the four cards under it - your focus, today's agenda
          from the roster, what is due in seven days, the latest updates */}
      <TabZone label={L("My work", "Kerja saya")} className={view !== "mine" ? tk.off : ""}>
      <KpiRow label={L("My task figures", "Angka tugasan saya")}>
        <KpiTile icon="assignment" tone="blue" label={L("Assigned Today", "Diberikan Hari Ini")} value={myTasks.filter((t) => (t.created_at ?? "").slice(0, 10) === todayISO).length} busy={!loaded}
          sub={L("New tasks assigned to you", "Tugasan baharu untuk anda")} />
        <KpiTile icon="date" tone="gold" label={L("Due Soon", "Hampir Tamat")} value={myActive.filter((t) => t.deadline && t.deadline >= todayISO && t.deadline <= plusDays(3)).length} busy={!loaded}
          sub={L("Due in the next 3 days", "Perlu siap dalam 3 hari")} onClick={() => { clearFilters(); setSortK("deadline"); }} />
        <KpiTile icon="warning" tone="red" label={L("Overdue", "Lewat")} value={myActive.filter(isOverdue).length} busy={!loaded}
          sub={L("Past due and require attention", "Lepas tarikh dan perlu perhatian")} onClick={() => { clearFilters(); setStatusF("overdue"); }} />
        <KpiTile icon="success" tone="green" label={L("Completed This Week", "Selesai Minggu Ini")} value={myTasks.filter((t) => t.status === "completed" && t.stage !== "cancelled" && (t.closed_at ?? "").slice(0, 10) >= mondayOf(todayISO)).length} busy={!loaded}
          sub={L("Tasks you closed (Mon - Sun)", "Tugasan anda tutup (Isn - Ahd)")} onClick={() => go("reports", "task-archive")} />
      </KpiRow>
      <div className={t5.withPreview}>
      {(() => {
        const modeRow = (
          <div className={tk.modeRow}>
            <div role="group" aria-label={L("View", "Paparan")} className={tk.mode}>
              <button type="button" aria-pressed={mineMode === "list"} onClick={() => setMineMode("list")}><AppIcon name="orders" />{L("List", "Senarai")}</button>
              <button type="button" aria-pressed={mineMode === "board"} onClick={() => setMineMode("board")}><AppIcon name="chart" />{L("Board", "Papan")}</button>
            </div>
          </div>
        );
        const subMine = L("Tasks assigned to you. Update progress, manage subtasks, and request closure.", "Tugasan yang diberikan kepada anda. Kemas kini kemajuan, urus subtugasan, dan mohon penutupan.");
        return mineMode === "list" ? renderTasks(sift(myTasks, { status: true }), L("My Tasks", "Tugasan Saya"), !loaded, {
          sub: subMine,
          empty: statusF === "active" && !needle && !prioF ? caughtUp : <p className={tk.empty}><AppIcon name="search" />{L("No task matches — clear the search or a filter.", "Tiada tugasan sepadan — kosongkan carian atau penapis.")}</p>,
          tools: <>{modeRow}{toolbar(false)}</>,
          select: { id: pickedTask, set: setPickedTask },
        }) : (
          <div className={card}>
            <div className={tk.head}>
              <div className={tk.headText}>
                <p className={tk.title}>{L("My Tasks", "Tugasan Saya")}</p>
                <p className={tk.sub}>{subMine}</p>
              </div>
              <span className={tk.count}>{sift(myTasks).length}</span>
            </div>
            {modeRow}
            {toolbar(false, false)}
            {!loaded ? <SkelRows rows={4} /> : renderBoard(sift(myTasks))}
          </div>
        );
      })()}
      <TaskPreview task={myTasks.find((t) => t.id === pickedTask) ?? sift(myTasks, { status: true })[0] ?? null}
        onOpen={(id) => void openChecklist(id)} onUpdate={(id) => { setSheetFor(id); void openChecklist(id); }} />
      </div>
      {view === "mine" && <MyDayCards mine={myTasks} today={todayISO} userId={user.id} onOpen={(id) => void openChecklist(id)} onArchive={() => go("reports", "task-archive")} />}
      </TabZone>

      {/* ============================== ALL TASKS ============================== */}
      {/* v1.313.0 - TASKS 5.0 (image 3): five figures, the register with Edit
          on each row (the existing Edit: title, dates, priority, assignee -
          the server decides who may), and beside it the workload, the
          departments and the tasks waiting for review */}
      {canManage && (
      <TabZone label={L("The work", "Kerja")} className={view !== "all" ? tk.off : ""}>
      <KpiRow label={L("Task register figures", "Angka daftar tugasan")}>
        <KpiTile icon="orders" tone="blue" label={L("Open Tasks", "Tugasan Terbuka")} value={openTasks.length} busy={!loaded}
          sub={L("All active and unclosed tasks", "Semua tugasan aktif dan belum ditutup")} onClick={() => { clearFilters(); setStatusF("active"); }} />
        <KpiTile icon="pending" tone="gold" label={L("In Progress", "Sedang Berjalan")} value={pendingCount} busy={!loaded}
          sub={L("Currently being worked on", "Sedang diusahakan")} onClick={() => { clearFilters(); setStatusF("in_progress"); }} />
        <KpiTile icon="time" tone="purple" label={L("Waiting Review", "Menunggu Semakan")} value={openTasks.filter((t) => t.stage === "review").length} busy={!loaded}
          sub={L("Submitted, awaiting approval", "Dihantar, menunggu kelulusan")} onClick={() => { clearFilters(); setStatusF("review"); }} />
        <KpiTile icon="warning" tone="red" label={L("Overdue", "Lewat")} value={overdueCount} busy={!loaded}
          sub={L("Past due and require attention", "Lepas tarikh dan perlu perhatian")} onClick={() => { clearFilters(); setStatusF("overdue"); }} />
        <KpiTile icon="success" tone="green" label={L("Closed This Week", "Ditutup Minggu Ini")} value={tasks.filter((t) => t.status === "completed" && t.stage !== "cancelled" && (t.closed_at ?? "").slice(0, 10) >= mondayOf(todayISO)).length} busy={!loaded}
          sub={L("Closed Mon - Sun", "Ditutup Isn - Ahd")} onClick={() => go("reports", "task-archive")} />
      </KpiRow>
      <div className={t5.splitWide}>
      {(() => {
        /* v1.209.0 - the same rows as a list (paged) or as a board */
        const allModeRow = (
          <div className={tk.modeRow}>
            <div role="group" aria-label={L("View", "Paparan")} className={tk.mode}>
              <button type="button" aria-pressed={allMode === "list"} onClick={() => setAllMode("list")}><AppIcon name="orders" />{L("List", "Senarai")}</button>
              <button type="button" aria-pressed={allMode === "board"} onClick={() => setAllMode("board")}><AppIcon name="chart" />{L("Board", "Papan")}</button>
            </div>
          </div>
        );
        const subAll = L("Company-wide task register, scoped to your role. Manage, update, and track progress across all tasks.", "Daftar tugasan seluruh syarikat, mengikut peranan anda. Urus, kemas kini dan jejak kemajuan semua tugasan.");
        return allMode === "list" ? renderTasks(sift(tasks, { status: true, who: true }), L("All Tasks", "Semua Tugasan"), !loaded, {
          who: true,
          dept: true,
          edit: true,
          sub: subAll,
          empty: <p className={tk.empty}><AppIcon name="search" />{L("No task matches — clear the search or a filter.", "Tiada tugasan sepadan — kosongkan carian atau penapis.")}</p>,
          tools: <>{allModeRow}{toolbar(true)}</>,
          pager: { page: allPage, set: setAllPage },
        }) : (
          <div className={card}>
            <div className={tk.head}>
              <div className={tk.headText}>
                <p className={tk.title}>{L("All Tasks", "Semua Tugasan")}</p>
                <p className={tk.sub}>{subAll}</p>
              </div>
              <span className={tk.count}>{sift(tasks, { who: true }).length}</span>
            </div>
            {allModeRow}
            {toolbar(true, false)}
            {!loaded ? <SkelRows rows={4} /> : renderBoard(sift(tasks, { who: true }))}
          </div>
        );
      })()}
      <div className={t5.side}>
        <WorkloadCard tasks={tasks} onPick={(id) => { clearFilters(); setWhoF(id); }} />
        <DepartmentCard tasks={tasks} deptOf={deptOf} />
        <QuickApprovals tasks={tasks} onOpen={(id) => void openChecklist(id)} onAll={() => { clearFilters(); setStatusF("review"); }} />
      </div>
      </div>
      </TabZone>
      )}

      {view === "calendar" && canProjects && calProjects === null && <CalProjectsLoader manage={canManage} onLoad={setCalProjects} />}
      {/* ============================== CALENDAR ============================== */}
      {/* v1.313.0 - TASKS 5.0 (image 2, TK-10): one calendar over the work
          records already kept - task due dates, tasks waiting for review,
          the task blocks and lives on the roster, project due dates. No
          calendar table; Leave, holidays and the attendance roster keep
          their own. Client Meetings is not drawn: nothing records one. */}
      <TabZone label={L("Calendar", "Kalendar")} className={view !== "calendar" ? tk.off : ""}>
        {view === "calendar" && (!loaded ? <SkelRows rows={6} /> : (
          <WorkCalendar tasks={canManage ? tasks : myTasks} projects={canProjects ? calProjects : []} today={todayISO} month={calMonth} setMonth={setCalMonth}
            staff={canManage ? team : null} onOpenTask={(id) => void openChecklist(id)} onOpenProject={(id) => { setProjOpen(id); setView("projects"); }} />
        ))}
      </TabZone>

      {/* v1.307.0 - ATTENDANCE 4.0 (A-3, the CEO 14-11-2026): the operational
          roster - lives, task blocks, sales duty - left Attendance (whose Shift
          Roster is now the expected working schedule only) and lives here
          beside the deadlines it plans. The same board, the same gates as on
          Attendance: canManage, canEdit, and task_delete (the CEO alone). */}
      {view === "calendar" && (
        <>
          {canManage && (
            <TabZone label={L("Today's assignments", "Tugasan hari ini")}>
              <TodayAssignmentsCard canManage={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)}
                onOpenRoster={() => revealAnchor("roster-board")} />
            </TabZone>
          )}
          <TabZone label={L("Roster board", "Papan roster")} hint={L("Lives, task blocks and sales duty by week; the board the Dashboard's assignments open.", "Live, blok tugasan dan tugas jualan mengikut minggu; papan yang dibuka oleh tugasan di Dashboard.")}>
            <div id="roster-board" className={tk.rosterAnchor}>
              <RosterBoard
                canManage={["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role)}
                canEdit={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)}
                /* v1.171.0 (CEO, 20-09-2026: "on the attendance, the Task
                   should be able to delete!") - mirrors task_delete in
                   worker/src/permissions.ts, which is the CEO alone. */
                canDeleteTask={holds("task_delete", ["ceo", "super_admin"].includes(user.role))}
              />
            </div>
          </TabZone>
        </>
      )}

      {/* ============================== PROJECTS ============================== */}
      {/* v1.245.0 - the project briefs: no new sidebar item, they live here
          and on their quotation's page in Sales (the owner's brief) */}
      <TabZone label={L("Project briefs", "Ringkasan projek")} className={view !== "projects" ? tk.off : ""}>
        {canProjects && view === "projects" && <ProjectsBoard openId={projOpen} onOpen={setProjOpen} />}
      </TabZone>

      {/* ============================ REPORTS & ARCHIVE ============================ */}
      {/* v1.313.0 - TASKS 5.0 (image 5): four figures, the operational
          reports beside the Live Host card, the archive, then the management
          cards that were here. The Live Host Report form, its GMV evidence and
          report review come with Gate 4 (TK-1, TK-14) - nothing is pretended. */}
      <TabZone label={L("Reports and archive", "Laporan dan arkib")} className={view !== "reports" ? tk.off : ""}>
        <KpiRow label={L("Reports figures", "Angka laporan")}>
          <KpiTile icon="documents" tone="blue" label={L("Reports Submitted", "Laporan Dihantar")} value={canTaskReports ? reportsThisMonth : "—"} busy={canTaskReports && reportRows.loading && !reportRows.data}
            sub={canTaskReports ? L(`This month · ${reportsLastMonth} last month`, `Bulan ini · ${reportsLastMonth} bulan lepas`) : L("Read by management", "Dibaca oleh pengurusan")} onClick={() => revealAnchor("task-reports")} />
          <KpiTile icon="time" tone="gold" label={L("Awaiting Review", "Menunggu Semakan")} value={(canManage ? openTasks : myActive).filter((t) => t.stage === "review").length} busy={!loaded}
            sub={L("Tasks waiting for management review", "Tugasan menunggu semakan pengurusan")} onClick={() => { clearFilters(); setStatusF("review"); go(canManage ? "all" : "mine"); }} />
          <KpiTile icon="folder" tone="green" label={L("Archived", "Diarkibkan")} value={closed.length} busy={!loaded}
            sub={L("Closed tasks on the board", "Tugasan ditutup pada papan")} onClick={() => revealAnchor("task-archive")} />
          <KpiTile icon="live" tone="red" label={L("Live Host Sessions", "Sesi Hos Live")} value={L("Gate 4", "Gate 4")} sub={L("Reports with GMV and evidence - not built yet", "Laporan dengan GMV dan bukti - belum dibina")} />
        </KpiRow>
        <div className={t5.split}>
          {canTaskReports && reportsSeen ? (
            <div id="task-reports" data-testid="task-reports">
              <TaskReports />
            </div>
          ) : <section className={card} aria-label={L("Operational reports", "Laporan operasi")}><Head5 icon="documents" title={L("Operational Reports", "Laporan Operasi")} sub={L("Daily, weekly and monthly reports are written and read by management.", "Laporan harian, mingguan dan bulanan ditulis dan dibaca oleh pengurusan.")} /></section>}
          {view === "reports" && <LiveHostCard today={todayISO} />}
        </div>
        {/* the company-wide card (management roles), as before */}
        {progress}
        {/* v1.247.0 - task emails: settings, preview, delivery log (CEO, COO, CCO; the server decides) */}
        {["ceo", "coo", "cco", "super_admin"].includes(user.role) && view === "reports" && <TaskMailPanel />}
        {canManage && (
          <section className={card} aria-label={L("Staff task performance", "Prestasi tugasan kakitangan")}>
            {head("trophy", tk.goldWell, L("Staff Task Performance", "Prestasi Tugasan Kakitangan"), L("From the tasks on the board: closed out of total, and what is late.", "Daripada tugasan pada papan: ditutup daripada jumlah, dan yang lewat."))}
            {!loaded ? <SkelRows rows={4} /> : assignees.length === 0 ? <p className={tk.empty}>{L("No tasks yet.", "Belum ada tugasan.")}</p> : (
              <div className={`erp-table-scroll erp-mt-2 ${tk.tableWrap}`}>
                <table className={tk.plain} aria-label={L("Staff task performance", "Prestasi tugasan kakitangan")}>
                  <thead><tr><th>{L("Staff", "Kakitangan")}</th><th className={tk.num}>{L("Active", "Aktif")}</th><th className={tk.num}>{L("Overdue", "Lewat")}</th><th className={tk.num}>{L("Closed", "Selesai")}</th><th className={tk.num}>{L("Total", "Jumlah")}</th><th>{L("Closed share", "Bahagian ditutup")}</th></tr></thead>
                  <tbody>
                    {assignees.map((a) => {
                      const share = a.total > 0 ? Math.round((a.closed / a.total) * 100) : 0;
                      return (
                        <tr key={a.id}>
                          <td><span className={tk.who}><Avatar name={a.name} photoKey={a.photo} size="sm" /><span>{a.name}</span></span></td>
                          <td className={tk.num}>{a.open + a.pending}</td>
                          <td className={`${tk.num} ${a.overdue > 0 ? tk.danger : ""}`}>{a.overdue}</td>
                          <td className={tk.num}>{a.closed}</td>
                          <td className={tk.num}>{a.total}</td>
                          <td><span className={tk.progress}><span className={tk.track} aria-hidden><span className={`${tk.fill} ${tk.fillDone}`} style={{ width: `${share}%` }} /></span><span className={tk.pct}>{share}%</span></span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      <div id="task-archive">
        {renderTasks([...tasks.filter((t) => t.status === "completed"), ...older.filter((o) => !tasks.some((t) => t.id === o.id))].filter((t) => !archNeedle || [t.title, t.description ?? "", t.assignee ?? ""].some((x) => x.toLowerCase().includes(archNeedle))), L("Completed tasks", "Tugasan selesai"), !loaded, {
          who: canManage,
          pager: { page: archPage, set: setArchPage },
          /* v1.209.0 - the board read is the newest 200 (100 for your own);
             the archive says so rather than looking complete. The owner chose
             "not now" for a server page past them. */
          sub: <>{L("Closed tasks stay here with their scope checklist — who ticked each item and when. Set a status back to Open or In progress to re-open one.", "Tugasan yang ditutup kekal di sini dengan senarai skopnya — siapa menanda setiap item dan bila. Tetapkan status kembali kepada Terbuka atau Sedang dibuat untuk membukanya semula.")} {L(`Every open task is on the board; the newest ${closed.length + older.length} closed ones are searched here.`, `Semua tugasan terbuka ada pada papan; ${closed.length + older.length} tugasan ditutup terbaharu dicari di sini.`)}</>,
          tools: (
            <div className={tk.toolbar} role="search">
              <label className={tk.search}>
                <AppIcon name="search" />
                <input type="search" value={archQ} aria-label={L("Search the archive", "Cari dalam arkib")}
                  placeholder={L("Search closed tasks…", "Cari tugasan ditutup…")} onChange={(e) => { setArchQ(e.target.value); setArchPage(1); }} />
              </label>
              {/* v1.246.0 (audit A9) - the board carries the newest 300 closed
                  tasks; older ones are fetched 300 at a time, on a press */}
              {olderNext !== 0 && <button type="button" className={btnSm} disabled={olderBusy} aria-busy={olderBusy || undefined} onClick={() => void loadOlder()}>{L("Load older closed tasks", "Muat tugasan ditutup yang lebih lama")}</button>}
            </div>
          ),
        })}
      </div>
        <section className={card} aria-label={L("Task history", "Sejarah tugasan")}>
          {head("time", tk.blueWell, L("Task History", "Sejarah Tugasan"))}
          <ul className={tk.rules}>
            <li>{L("Each task's checklist keeps who ticked every item and when — open it from the scope chip on the task.", "Senarai semak setiap tugasan menyimpan siapa menanda setiap item dan bila — buka daripada cip skop pada tugasan.")}</li>
            <li>{L("Status moves, acknowledgements and reminders are recorded by the system as they happen, and the other person is notified.", "Perubahan status, pengakuan terima dan peringatan direkodkan oleh sistem semasa berlaku, dan orang yang satu lagi dimaklumkan.")}</li>
            <li className={tk.proposal}><AppIcon name="idea" />{L("Proposed, not built: a per-task timeline of those recorded moves. The records exist; showing them needs a new read on the server — it would come to you for approval first.", "Dicadangkan, belum dibina: garis masa setiap tugasan bagi perubahan yang direkodkan itu. Rekodnya wujud; memaparkannya memerlukan bacaan baharu di pelayan — ia akan dibawa kepada anda untuk kelulusan dahulu.")}</li>
          </ul>
        </section>
      </TabZone>
      {/* ========================== CREATE / ASSIGN TASK ========================== */}
      {/* v1.209.0 - the same form and the same create(), in a drawer from the
          + Create Task button, so the list stays where it was */}
      <SideDrawer open={createOpen} onClose={() => setCreateOpen(false)} wide
        title={canManage ? L("Create / assign a task", "Buat / agih tugasan") : L("Create a task", "Buat tugasan")}
        subtitle={L("You know your work best — add your own tasks with a deadline and track them as open, pending, or closed.", "Anda paling tahu kerja anda — tambah tugasan sendiri dengan tarikh akhir dan jejak sebagai terbuka, menunggu atau selesai.")}>
        <div className={`${tk.form} ${tk.formDrawer}`} id="task-form">
          <div className={tk.formMain}>
          <Sub t={L("Title *", "Tajuk *")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. Prepare LIVE rundown",
                "cth. Sediakan rundown LIVE"
              )}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Description", "Keterangan")}>
            <textarea
              className={inputClass}
              rows={2}
              placeholder={L("What needs doing?", "Apa yang perlu dibuat?")}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Scope — one deliverable per line", "Skop — satu hasil kerja setiap baris")}>
            <textarea
              className={inputClass}
              rows={4}
              placeholder={L(
                "e.g.\nDraft the catalogue layout\nCollect product photos\nSend PDF for approval",
                "cth.\nDraf susun atur katalog\nKumpul foto produk\nHantar PDF untuk kelulusan"
              )}
              value={draft.scope}
              onChange={(e) =>
                setDraft((d) => ({ ...d, scope: e.target.value }))
              }
            />
            <p className={tk.hint}>
              {L(
                "Each line becomes a tickable item — progress counts itself as the staff tick them off.",
                "Setiap baris menjadi item boleh ditanda — kemajuan dikira sendiri apabila kakitangan menandanya."
              )}
              {draft.scope.trim() && <> <strong>{L(`${draft.scope.split("\n").map((l) => l.trim()).filter(Boolean).length} item(s)`, `${draft.scope.split("\n").map((l) => l.trim()).filter(Boolean).length} item`)}</strong></>}
            </p>
          </Sub>
          </div>
          <div className={tk.formSide}>
          {canManage && (
            <Sub t={L("Assign to", "Agihkan kepada")}>
              <select
                className={inputClass}
                value={draft.assigned_to}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assigned_to: Number(e.target.value),
                  }))
                }
              >
                <option value={0}>
                  {L("Assign to myself", "Agih kepada diri sendiri")}
                </option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Sub>
          )}
            {/* v1.246.2 - the owner, 01-11-2026: "Create a task should be able
                to capture that Quotation" - the task joins the quotation's
                project (created on the spot when there is none yet). */}
            <Sub t={L("For a quotation (optional)", "Untuk sebut harga (pilihan)")}>
              <select className={inputClass} value={draft.quotation_id} aria-label={L("For a quotation (optional)", "Untuk sebut harga (pilihan)")}
                onChange={(e) => setDraft((d) => ({ ...d, quotation_id: Number(e.target.value) }))}>
                <option value={0}>{L("No quotation — a standalone task", "Tiada sebut harga — tugasan berasingan")}</option>
                {(quotes ?? []).map((q) => (
                  <option key={q.id} value={q.id}>{q.doc_number} · {q.company}{q.project_id ? "" : L(" · new project", " · projek baharu")}</option>
                ))}
              </select>
              <p className={tk.hint}>
                {draft.quotation_id ? L("This task becomes a project task of that quotation — it shows under Projects and on the quotation's Project & Tasks tab.", "Tugasan ini menjadi tugasan projek sebut harga itu — ia dipaparkan di bawah Projek dan pada tab Projek & Tugasan sebut harga itu.")
                    : quotes !== null && quotes.length === 0 ? L("No live quotation to set a task under.", "Tiada sebut harga aktif untuk tugasan.")
                      : L("Pick a quotation to make this a project task.", "Pilih sebut harga untuk menjadikannya tugasan projek.")}
              </p>
            </Sub>
            <Sub t={L("Priority", "Keutamaan")}>
              <select
                className={inputClass}
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {priorityL(p)}
                  </option>
                ))}
              </select>
            </Sub>
            <Sub t={L("Start date (optional)", "Tarikh mula (pilihan)")}>
              <input
                type="date"
                className={inputClass}
                value={draft.start_date}
                max={draft.deadline || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
              />
            </Sub>
            <Sub t={L("Due date (optional)", "Tarikh siap (pilihan)")}>
              <input
                type="date"
                className={inputClass}
                min={draft.start_date || undefined}
                value={draft.deadline}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, deadline: e.target.value }))
                }
              />
            </Sub>
          <button
            type="button"
            className={`${btnClass} ${tk.submit}`}
            disabled={!draft.title.trim()}
            title={!draft.title.trim() ? L("A title is needed first", "Tajuk diperlukan dahulu") : undefined}
            onClick={() => void create()}
          >
            {L("Create task", "Buat tugasan")}
          </button>
          {!canManage && <p className={tk.hint}>{L("A task you create is assigned to you.", "Tugasan yang anda buat diberikan kepada anda.")}</p>}
          </div>
        </div>
      </SideDrawer>

      {/* ============================== THE TASK DRAWER ============================== */}
      {(() => {
        const t = openTask == null ? null : tasks.find((x) => x.id === openTask) ?? null;
        if (!t) return null;
        const mine = isMine(t);
        const canEdit = (mine || canManage) && t.status !== "completed"; // v1.289.0 (T1) - a closed task is reopened first
        const creator = t.created_by == null ? null : t.created_by === user.id ? L("You", "Anda") : team.find((u) => u.id === t.created_by)?.name ?? null;
        const startEdit = () => setEditing({ title: t.title, description: t.description ?? "", priority: t.priority, start_date: t.start_date ?? "", deadline: t.deadline ?? "", assigned_to: t.assigned_to ?? 0 });
        const saveEdit = async () => {
          if (!editing || !editing.title.trim()) return;
          const patch: Record<string, unknown> = {};
          if (editing.title.trim() !== t.title) patch.title = editing.title.trim();
          if (editing.description !== (t.description ?? "")) patch.description = editing.description;
          if (editing.priority !== t.priority) patch.priority = editing.priority;
          if (editing.deadline !== (t.deadline ?? "")) patch.deadline = editing.deadline;
          if (editing.start_date !== (t.start_date ?? "")) patch.start_date = editing.start_date;
          if (canManage && editing.assigned_to && editing.assigned_to !== t.assigned_to) patch.assigned_to = editing.assigned_to;
          if (Object.keys(patch).length === 0) { setEditing(null); return; }
          if (await update(t.id, patch)) setEditing(null);
        };
        return (
          <SideDrawer open onClose={closeDetail} wide full title={t.title}
            subtitle={<span className={tk.badges}>
              <span className={`${PRIORITY_CHIP[t.priority] ?? chipNeutral} ${tk.cap}`}>{priorityL(t.priority)}</span>
              <StateChip status={t.status} stage={t.stage ?? null} />{/* v1.246.0 - status and stage together */}
              {t.deadline && (t.status === "completed"
                ? <span className={chipNeutral}>{t.closed_late_days ? L(`Was due ${dmy(t.deadline)} · closed ${t.closed_late_days} day(s) late`, `Sepatutnya ${dmy(t.deadline)} · ditutup lewat ${t.closed_late_days} hari`) : L(`Was due ${dmy(t.deadline)}`, `Sepatutnya ${dmy(t.deadline)}`)}</span>
                : <span className={isOverdue(t) ? chipDanger : chipNeutral}>{isOverdue(t) ? L(`Overdue — was due ${dmy(t.deadline)}`, `Lewat — sepatutnya ${dmy(t.deadline)}`) : L(`Due ${dmy(t.deadline)}`, `Perlu siap ${dmy(t.deadline)}`)}</span>)}
            </span>}
            footer={(ackControl(t) || deleteBtn(t)) ? <span className={tk.drawerFoot}>{ackControl(t)}{deleteBtn(t)}</span> : undefined}>
            <div className={tk.detail} data-record={`task:${t.id}`}>
              {/* v1.246.0 - Details (the task information and checklist, as
                  before) · Updates & Comments · Files · Activity, the review
                  bar and the helpers: task-progress.tsx, the same pieces the
                  project rows and the phone open */}
              <TaskProgressTabs key={`${t.id}:${sheetFor === t.id ? "s" : "d"}`} taskId={t.id} startSheet={sheetFor === t.id} onChanged={() => { setSheetFor(null); void load(); }} details={<>
              <section className={tk.detailSec} aria-label={L("Task information", "Maklumat tugasan")}>
                <div className={tk.detailHead}>
                  <p className={tk.title}>{L("Task information", "Maklumat tugasan")}</p>
                  {canEdit && !editing && <button type="button" className={btnSm} onClick={startEdit}><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
                </div>
                {editing ? (
                  <div className={tk.editForm}>
                    <Sub t={L("Title *", "Tajuk *")}><input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Sub>
                    <Sub t={L("Description", "Keterangan")}><textarea className={inputClass} rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Sub>
                    <div className={tk.editRow}>
                      <Sub t={L("Priority", "Keutamaan")}>
                        <select className={inputClass} value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                          {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{priorityL(p)}</option>)}
                        </select>
                      </Sub>
                      <Sub t={L("Start date", "Tarikh mula")}><input type="date" className={inputClass} value={editing.start_date} max={editing.deadline || undefined} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Sub>
                      <Sub t={L("Due date", "Tarikh siap")}><input type="date" className={inputClass} value={editing.deadline} min={editing.start_date || undefined} onChange={(e) => setEditing({ ...editing, deadline: e.target.value })} /></Sub>
                    </div>
                    {canManage && (
                      <Sub t={L("Assigned to", "Diberikan kepada")}>
                        <select className={inputClass} value={editing.assigned_to} onChange={(e) => setEditing({ ...editing, assigned_to: Number(e.target.value) })}>
                          {!team.some((u) => u.id === editing.assigned_to) && <option value={editing.assigned_to}>{t.assignee ?? L("Current assignee", "Penerima semasa")}</option>}
                          {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </Sub>
                    )}
                    <p className={tk.hint}>{L("Saved through the same update the Roster's Edit uses; a new assignee is told and asked to acknowledge.", "Disimpan melalui kemas kini yang sama digunakan oleh Sunting Roster; penerima baharu dimaklumkan dan diminta mengakui.")}</p>
                    <span className={tk.editBtns}>
                      <button type="button" className={btnSm} onClick={() => setEditing(null)}>{L("Cancel", "Batal")}</button>
                      <button type="button" className={btnClass} disabled={!editing.title.trim()} onClick={() => void saveEdit()}>{L("Save changes", "Simpan perubahan")}</button>
                    </span>
                  </div>
                ) : (
                  <>
                    <p className={tk.label}>{L("Description", "Keterangan")}</p>
                    {t.description ? <p className={tk.descBox}>{t.description}</p> : <p className={tk.muted}>{L("No description.", "Tiada keterangan.")}</p>}
                    <dl className={tk.facts}>
                      <div><dt>{L("Assigned to", "Diberikan kepada")}</dt><dd>{t.assignee ? <span className={tk.who}><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}{positionOf(t.assigned_to) ? <span className={tk.muted}> · {positionOf(t.assigned_to)}</span> : null}</span></span> : mine ? L("You", "Anda") : "—"}</dd></div>
                      {creator && <div><dt>{L("Created by", "Dibuat oleh")}</dt><dd>{creator}</dd></div>}
                      <div><dt>{L("Priority", "Keutamaan")}</dt><dd className={tk.cap}>{priorityL(t.priority)}</dd></div>
                      <div><dt>{L("Start date", "Tarikh mula")}</dt><dd>{t.start_date ? dmy(t.start_date) : L("Not set", "Belum ditetapkan")}</dd></div>
                      <div><dt>{L("Due date", "Tarikh siap")}</dt><dd>{t.deadline ? dmy(t.deadline) : L("No due date", "Tiada tarikh siap")}</dd></div>
                      <div><dt>{L("Acknowledged", "Diakui")}</dt><dd>{!isAssigned(t) ? L("Not needed — self-set", "Tidak perlu — ditetapkan sendiri") : t.acknowledged ? L("Yes", "Ya") : L("Not yet", "Belum")}</dd></div>
                    </dl>
                  </>
                )}
              </section>
              <section className={tk.detailSec} aria-label={L("Deliverables checklist", "Senarai semak hasil kerja")}>
                <div className={tk.detailHead}>
                  <p className={tk.title}>{L(`Deliverables checklist (${t.item_done ?? 0}/${t.item_count ?? 0})`, `Senarai semak hasil kerja (${t.item_done ?? 0}/${t.item_count ?? 0})`)}</p>
                </div>
                {progressBar(t)}
                {checklist(t)}
              </section>
              </>} />
            </div>
          </SideDrawer>
        );
      })()}
    </TabPage>
  );
}

/** v1.250.1 - loads the projects the Deadlines calendar shows: every project for
    management, otherwise the ones this person owns or has a task on. */
function CalProjectsLoader({ manage, onLoad }: { manage: boolean; onLoad: (rows: { id: number; title: string; company: string | null; due_date: string | null; status: string; doc_number?: string | null }[]) => void }) {
  /* skeleton: none — this draws nothing; the calendar already shows its own skeleton while the tasks load, and project chips join the grid when they land */
  useEffect(() => {
    const c = new AbortController();
    type R = { projects?: { id: number; title: string; company: string | null; due_date: string | null; status: string; doc_number?: string | null }[] };
    const scopes = manage ? ["all"] : ["assigned", "mine"];
    void Promise.all(scopes.map((sc) => api<R>(`/staff/projects?scope=${sc}`, { signal: c.signal }))).then((res) => {
      if (c.signal.aborted) return;
      const seen = new Map<number, NonNullable<R["projects"]>[number]>();
      for (const r of res) for (const p of r.data?.projects ?? []) seen.set(p.id, p);
      onLoad([...seen.values()]);
    });
    return () => c.abort();
  }, [manage, onLoad]);
  return null;
}
