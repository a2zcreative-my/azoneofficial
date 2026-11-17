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
import { type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { ProjectsBoard } from "@/components/portal/project-workspace"; // v1.245.0
import { TaskHistory } from "@/components/portal/task-history"; // v1.337.0 - Reports & Archive > Task History (the existing activity read)
import { TaskReports } from "@/components/portal/task-reports"; // v1.306.0 - HR 4.0 (H-1): the written reports' one home
import { StateChip, day, stamp } from "@/components/portal/task-progress"; // v1.246.0 - progress, comments, files, activity
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { dmy } from "@/lib/format";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
import { SideDrawer } from "@/components/ui/side-drawer";
import { ViewSwitch } from "@/components/portal/executive-cards"; // v1.313.0 - the phone view switch
import { useTabViewAddress } from "@/lib/tab-view";
import { atLeast, onBreakpoint, type Breakpoint } from "@/lib/breakpoints";
import { PriorityChip, TaskDetailDrawer, TaskWorkspace } from "@/components/portal/task-workspace"; // v1.319.0 - Tasks 2.0 Stage 1; v1.321.0 - one pane, beside the list or in the drawer
import { ColumnPicker, CompactTaskTable, TaskToolbar, type SortDir, type TableCol } from "@/components/portal/task-table"; // v1.321.0 - the Unified Workspace
import { MetricStrip } from "@/components/ui/metric-strip";
import { FilterField, FilterPopover } from "@/components/ui/filter-popover";
import { PaginationControls, type PageSize } from "@/components/ui/pagination-controls";
import { PillSwitch } from "@/components/ui/panel";
import { FillPanel } from "@/components/ui/fill-panel"; // v1.323.0 - D-4
import { ActivityFeed, FlowBoard, Head2, MyTaskCards, MyTaskTable, MyToday, OverviewTable, QuickLinks, StaffPerformance, WeeklySummary, WorkflowStrip, byUrgency2 } from "@/components/portal/tasks2";
import { closedThisWeek } from "@/lib/task-flow";
import { usePortal } from "@/components/portal/portal-provider"; // v1.328.0 - the calendar's one line to Roster & Scheduling
import tk from "./tasks-page.module.css";
import t2 from "./tasks2.module.css"; // v1.319.0 - kept after the page's own sheet (tests/kept-lines.mjs reads the first module import)
import { DepartmentCard, Head5, MyDayCards, QuickApprovals, WorkCalendar, WorkloadCard, mondayOf, prioWord } from "@/components/portal/tasks5";

/* v1.209.0 - Create left the tab row for a drawer from the + button (the
   owner's Tasks brief, 25-10-2026); Calendar joined it, drawn from the
   deadlines already loaded. */
type TaskView = "overview" | "mine" | "all" | "projects" | "calendar" | "reports";
/* v1.313.0 - Tasks 5.0: the view in the address (/portal?tab=Tasks&view=...), Back/Forward between views */
const TASK_VIEWS: readonly TaskView[] = ["overview", "mine", "all", "projects", "calendar", "reports"];
const isTaskView = (v: string | null): v is TaskView => TASK_VIEWS.includes(v as TaskView);
type StatusF = "active" | "open" | "in_progress" | "completed" | "any" | "review" | "blocked" | "waiting_client" | "overdue" | "stale" | "assisting" | "set_by_me";
type SortK = "newest" | "deadline" | "priority" | "title" | "progress" | "status" | "assignee";
type OvStatus = "" | "todo" | "in_progress" | "review" | "done" | "overdue" | "blocked" | "waiting_client" | "stale" | "unacked";
/* v1.321.0 - the way each column sorts first (a second press turns it round) */
const SORT_FIRST: Record<SortK, SortDir> = { newest: "desc", deadline: "asc", priority: "desc", title: "asc", progress: "desc", status: "asc", assignee: "asc" };
const sortDirOf = (k: SortK, rev: boolean): SortDir => (SORT_FIRST[k] === "asc") !== rev ? "asc" : "desc";
/** the step a task is at, for the Status column's sort: To Do, In Progress, Review, Done */
const statusRank = (t: Task) => t.status === "completed" ? 3 : t.stage === "review" ? 2 : t.status === "in_progress" ? 1 : 0;
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
/** does the screen meet this tier now (lib/breakpoints.ts - never a typed number) */
const subTier = (bp: Breakpoint) => (cb: () => void) => onBreakpoint(bp, cb);
const SUBS = { md: subTier("md"), lg: subTier("lg"), xl: subTier("xl") } as const;
function useTier(bp: "md" | "lg" | "xl"): boolean {
  return useSyncExternalStore(SUBS[bp], () => atLeast(bp), () => false);
}

/* ================= Tasks ================= */

export function Tasks({ user, progress, initialView, focus }: { user: User; progress?: ReactNode; initialView?: string; focus?: RecordFocus | null }) {
  const { setTab: openTab, setTabStart } = usePortal();
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
  /* v1.337.0 - Reports & Archive in four focused views, one shown at a time (the CEO, 17-11-2026) */
  const [repView, setRepView] = useState<"reports" | "team" | "completed" | "history" | null>(null);
  const canTaskReports = holds("task_reports", ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"].includes(user.role));
  /* the Dashboard's "Create task" still opens the form: it is a drawer now */
  const [createOpen, setCreateOpen] = useState(() => initialView === "create");
  const [projOpen, setProjOpen] = useState<number | null>(null); // v1.245.0 - the project open in Tasks > Projects
  /* v1.209.0 - THE TASK DRAWER: one task, its facts, its checklist and the
     commands the row always had. `openTask` (which checklist is loaded) is
     the drawer's task. */
  const [editing, setEditing] = useState<null | { title: string; description: string; priority: string; start_date: string; deadline: string; assigned_to: number; reason?: string }>(null);
  useTabViewAddress("Tasks", view, setView, isTaskView);
  const go = (v: TaskView, anchor?: string) => {
    if (openTask != null && v !== view) closeDetail(); // v1.319.0 - a task shown beside the list or as a page belongs to the view it was opened in
    setView(v);
    /* v1.337.0 - Reports & Archive shows one view at a time: an anchor names it */
    if (anchor === "task-archive") { setRepView("completed"); return; }
    if (anchor === "task-reports") { setRepView("reports"); return; }
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
      showTaskToast(L("Not created", "Tidak dibuat"), why ?? L("The task did not reach the server — try again", "Tugasan itu tidak sampai ke pelayan — cuba lagi"), "error"); // v1.329.0 - a refusal waits for OK
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
  const openChecklist = async (id: number, how: "beside" | "open" = "open") => {
    setEditing(null);
    setOpenHow(how);
    setOpenTask(id); setItems(null);
    const r = await api<{ items: TaskItem[] }>(`/staff/tasks/${id}/items`);
    if (r.ok && r.data) setItems(r.data.items ?? []);
  };
  const closeDetail = () => { setOpenTask(null); setItems(null); setEditing(null); setSheetFor(null); setOpenHow("open"); };
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
        "error", // v1.329.0 - a refusal waits for OK
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
        "error", // v1.329.0 - a refusal waits for OK
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
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "error"); // v1.329.0 - a refusal waits for OK
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
    showTaskToast(L("Not saved", "Tidak disimpan"), (r.data as { error?: { message?: string } } | undefined)?.error?.message ?? fallback, "error"); // v1.329.0 - a refusal waits for OK
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
  /* v1.326.0 - My Tasks from 1024px: the register's page and rows per page */
  const [minePage, setMinePage] = useState(1);
  const [mineSize, setMineSize] = useState<PageSize>(10);
  /* v1.321.0 (the Unified Workspace brief) - All Tasks: rows per page, the
     column sort turned round, the hidden columns, Insights, and the filters
     behind Filters (department, due-date range) */
  const [allSize, setAllSize] = useState<PageSize>(15);
  const [sortRev, setSortRev] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(() => new Set(["subtasks"]));
  const [insights, setInsights] = useState(false);
  const [deptF, setDeptF] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  /* the Overview: the queue's page and the one panel beside it */
  const [ovPage, setOvPage] = useState(1);
  const [ovSize, setOvSize] = useState<PageSize>(10);
  const [ovPanel, setOvPanel] = useState<"people" | "activity" | "actions">("people");
  /* v1.319.0 (Tasks 2.0 Stage 1, T2-4) - HOW THE OPEN TASK IS SHOWN. There is
     ONE open task (openTask). "beside": chosen in the My Tasks list, shown
     beside it (picture 2, from 1280px). "open": opened on its own - the full
     page from 768px (picture 4), the drawer on a phone (as before). */
  const isLg = useTier("lg");
  const [openHow, setOpenHow] = useState<"beside" | "open">("open");
  /* the Overview's own filters (never the My / All Tasks toolbar's) */
  const [ovMode, setOvMode] = useState<"table" | "board">("table");
  const [ovStatus, setOvStatus] = useState<OvStatus>("");
  const [ovAbout, setOvAbout] = useState("");
  const [ovDept, setOvDept] = useState("");
  const [ovWho, setOvWho] = useState(0);
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
  const sift = (rows: Task[], opts: { status?: boolean; who?: boolean; more?: boolean } = {}) => rows
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
    .filter((t) => !opts.more || !deptF || deptOf(t.assigned_to) === deptF)
    .filter((t) => !opts.more || !dueFrom || (!!t.deadline && t.deadline >= dueFrom))
    .filter((t) => !opts.more || !dueTo || (!!t.deadline && t.deadline <= dueTo))
    .filter((t) => !needle || [t.title, t.description ?? "", t.assignee ?? ""].some((x) => x.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const n = (() => {
        switch (sortK) {
          case "deadline": return (a.deadline || "9999").localeCompare(b.deadline || "9999");
          case "priority": return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
          case "title": return a.title.localeCompare(b.title);
          case "progress": return b.progress - a.progress;
          case "status": return statusRank(a) - statusRank(b);
          case "assignee": return (a.assignee ?? "~").localeCompare(b.assignee ?? "~");
          default: return 0; // the server's order: newest first
        }
      })();
      return sortRev ? -n : n;
    });
  /* a filter or a sort starts the My Tasks register again at its first page (set during render, not in an effect) */
  const mineKey = `${needle}|${statusF}|${prioF}|${aboutF}|${sortK}|${sortRev}`;
  const [mineKeySeen, setMineKeySeen] = useState(mineKey);
  if (mineKey !== mineKeySeen) { setMineKeySeen(mineKey); setMinePage(1); }
  const filtering = !!(needle || prioF || whoF || aboutF || deptF || dueFrom || dueTo || statusF !== "active");
  const clearFilters = () => { setQ(""); setPrioF(""); setWhoF(0); setAboutF(""); setDeptF(""); setDueFrom(""); setDueTo(""); setStatusF("active"); setSortK("newest"); setSortRev(false); setAllPage(1); };
  /** a column header: the first press sorts that way, the next turns it round */
  const sortBy = (k: SortK) => { if (k === sortK) setSortRev((v) => !v); else { setSortK(k); setSortRev(false); } setAllPage(1); };
  const abouts = useMemo(() => [...new Set(tasks.map((t) => t.link_label).filter((x): x is string => !!x))].sort(), [tasks]);
  /* the status filter: the toolbar's first choice, everywhere it is drawn */
  const statusFilter = (
    <select className={inputClassSm} aria-label={L("Status", "Status")} value={statusF} onChange={(e) => { setStatusF(e.target.value as StatusF); setAllPage(1); }}>
      <option value="active">{L("Active (open + in progress)", "Aktif (terbuka + sedang dibuat)")}</option>
      <option value="open">{L("To Do", "Belum Mula")}</option>
      <option value="in_progress">{L("In Progress", "Sedang Berjalan")}</option>
      <option value="completed">{L("Done", "Selesai")}</option>
      <option value="review">{L("Waiting for review", "Menunggu semakan")}</option>
      <option value="blocked">{L("Blocked", "Terhalang")}</option>
      <option value="waiting_client">{L("Waiting for client", "Menunggu pelanggan")}</option>
      <option value="overdue">{L("Overdue", "Lewat")}</option>
      <option value="stale">{L("No recent update", "Tiada kemas kini terkini")}</option>
      <option value="assisting">{L("I am helping on", "Saya membantu")}</option>
      <option value="set_by_me">{L("Set by me", "Ditetapkan oleh saya")}</option>
      <option value="any">{L("All statuses", "Semua status")}</option>
    </select>
  );
  /* v1.319.0 - `brief` (the narrow list beside the task, picture 2): the search and the status only */
  const toolbar = (withWho: boolean, withStatus = true, brief = false) => (
    <div className={`${tk.toolbar} ${brief ? tk.toolbarBrief : ""}`} role="search">
      <label className={tk.search}>
        <AppIcon name="search" />
        <input type="search" value={q} aria-label={L("Search tasks", "Cari tugasan")}
          placeholder={withWho ? L("Search title, description or staff…", "Cari tajuk, keterangan atau kakitangan…") : L("Search title or description…", "Cari tajuk atau keterangan…")}
          onChange={(e) => { setQ(e.target.value); setAllPage(1); }} />
      </label>
      {withStatus && statusFilter}
      {!brief && abouts.length > 0 && (
        <select className={inputClassSm} aria-label={L("Project or customer", "Projek atau pelanggan")} value={aboutF} onChange={(e) => { setAboutF(e.target.value); setAllPage(1); }}>
          <option value="">{L("All projects and customers", "Semua projek dan pelanggan")}</option>
          {abouts.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {!brief && <select className={inputClassSm} aria-label={L("Priority", "Keutamaan")} value={prioF} onChange={(e) => { setPrioF(e.target.value); setAllPage(1); }}>
        <option value="">{L("All priorities", "Semua keutamaan")}</option>
        {["urgent", "high", "normal", "low"].map((p) => <option key={p} value={p}>{priorityL(p)}</option>)}
      </select>}
      {withWho && (
        <select className={inputClassSm} aria-label={L("Assigned to", "Diberikan kepada")} value={whoF} onChange={(e) => { setWhoF(Number(e.target.value)); setAllPage(1); }}>
          <option value={0}>{L("Everyone", "Semua orang")}</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {!brief && <select className={inputClassSm} aria-label={L("Sort", "Isih")} value={sortK} onChange={(e) => setSortK(e.target.value as SortK)}>
        <option value="newest">{L("Newest first", "Terbaru dahulu")}</option>
        <option value="deadline">{L("Deadline, soonest", "Tarikh akhir, terdekat")}</option>
        <option value="priority">{L("Priority, highest", "Keutamaan, tertinggi")}</option>
        <option value="progress">{L("Progress, most done", "Kemajuan, paling siap")}</option>
        <option value="title">{L("Title, A–Z", "Tajuk, A–Z")}</option>
      </select>}
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

  /* v1.173.0 (tab concept) - the summary tier: the board's own figures,
     derived from the rows already loaded, never a second request. Open and
     overdue read from the same rule the list paints red with (v1.42.0). */
  /* v1.203.0 - the four figures come from lib/task-figures.ts, which the
     Dashboard's Task Overview reads too */
  const { openTasks, overdueCount, pendingCount } = taskFigures(tasks, todayISO);
  /* v1.321.0 - THE ALL TASKS COLUMNS (CompactTaskTable). The row is the
     register's row as it was - the name with its description, stage, link,
     acknowledgement and latest update; status; priority; due; the person;
     the department; progress; subtasks - and its commands (Edit, Update,
     Delete). A row opens its task; the commands do not. */
  const allCols = (): TableCol<Task>[] => [
    { key: "task", label: L("Task & Context", "Tugasan & Konteks"), sort: "title", main: true, cell: (t) => {
      const overdue = isOverdue(t);
      return (<>
        <span className={`${tk.taskTitle} ${overdue ? tk.danger : ""}`}>{t.title}</span>
        {t.description && <p className={`${tk.descLine} whitespace-pre-line`}>{t.description}</p>}
        <span className={tk.badges} onClick={(e) => { if ((e.target as HTMLElement).closest("button, a")) e.stopPropagation(); /* Acknowledge is its own command; the chips open the row */ }}>{stageChip(t)}{linkChip(t)}{ackControl(t)}</span>
        <span className={tk.latestLine}>{latestCell(t)}</span>
      </>);
    } },
    { key: "status", label: L("Status", "Status"), sort: "status", cell: (t) => <><StateChip status={t.status} stage={t.stage ?? null} />{t.status === "completed" && t.closed_at ? <span className={tk.muted}> {day(t.closed_at)}</span> : null}</> },
    { key: "priority", label: L("Priority", "Keutamaan"), sort: "priority", cell: (t) => <span className={PRIO_CHIP_5[t.priority] ?? chipNeutral}>{prioWord(t.priority)}</span> },
    { key: "due", label: L("Due Date", "Tarikh Akhir"), sort: "deadline", cell: (t) => {
      const overdue = isOverdue(t);
      return (
        <div className={tk.dates} title={t.start_date ? L(`From ${dmy(t.start_date)}`, `Dari ${dmy(t.start_date)}`) : undefined}>
          {t.deadline ? <span className={overdue ? tk.danger : ""}>{shortDate(t.deadline)}</span> : <span className={tk.muted}>—</span>}
          {overdue && <span className={`${tk.danger} ${tk.small}`}>{L("Overdue", "Lewat")}</span>}
        </div>
      );
    } },
    { key: "assignee", label: L("Assignee", "Penerima"), sort: "assignee", optional: true, cell: (t) => t.assignee ? <span className={tk.who}><Avatar name={t.assignee} photoKey={t.assignee_photo} size="sm" /><span>{t.assignee}</span></span> : <span className={tk.muted}>—</span> },
    { key: "dept", label: L("Department", "Jabatan"), optional: true, cell: (t) => deptOf(t.assigned_to) ? <span className={`${chipNeutral} ${tk.cap}`}>{deptOf(t.assigned_to)}</span> : <span className={tk.muted}>—</span> },
    { key: "progress", label: L("Progress", "Kemajuan"), sort: "progress", optional: true, cell: (t) => progressBar(t) },
    { key: "subtasks", label: L("Subtasks", "Subtugasan"), optional: true, cell: (t) => (t.item_count ?? 0) > 0 ? scopeChip(t) : <span className={tk.muted}>—</span> },
    { key: "actions", label: L("Actions", "Tindakan"), cmds: true, cell: (t) => {
      const editable = (isMine(t) || canManage) && t.status !== "completed";
      return (
        <span className={tk.rowActs}>
          {editable && (
            <button type="button" className={btnSm} aria-label={`${L("Edit", "Sunting")} — ${t.title}`} data-testid="row-edit"
              onClick={() => { void openChecklist(t.id); setEditing({ title: t.title, description: t.description ?? "", priority: t.priority, start_date: t.start_date ?? "", deadline: t.deadline ?? "", assigned_to: t.assigned_to ?? 0 }); }}>
              <AppIcon name="edit" />{L("Edit", "Sunting")}
            </button>
          )}
          {t.status !== "completed" && <button type="button" className={btnSm} aria-label={`${L("Update status", "Kemas kini status")} — ${t.title}`} data-testid="row-update" onClick={() => { setSheetFor(t.id); void openChecklist(t.id); }}>{L("Update", "Kemas kini")}</button>}
          {deleteBtn(t)}
        </span>
      );
    } },
  ];

  /* v1.246.0 - My Tasks: what I do, and what I help on (an assistant never
     replaces the person responsible - the row still names them) */
  const deptOf = (id?: number) => team.find((s) => s.id === id)?.department ?? "";
  const allDepts = [...new Set(tasks.map((t) => deptOf(t.assigned_to)).filter(Boolean))].sort();
  const myTasks = tasks.filter((t) => isMine(t) || (t.assistants ?? []).some((a) => a.id === user.id));
  const myActive = myTasks.filter((t) => t.status !== "completed");
  /* v1.319.0 - the My Tasks list as filtered, and the Overview's own scope and rows */
  const mineRows = sift(myTasks, { status: true });
  const ovScope = canManage ? tasks : myTasks;
  const ovOpen = ovScope.filter((t) => t.status !== "completed");
  const ovDone = ovScope.filter((t) => t.status === "completed" && t.stage !== "cancelled");
  const ovDepts = [...new Set(ovScope.map((t) => deptOf(t.assigned_to)).filter(Boolean))].sort();
  const ovRows = byUrgency2(ovScope.filter((t) =>
    (!ovAbout || t.link_label === ovAbout) && (!ovDept || deptOf(t.assigned_to) === ovDept) && (!ovWho || t.assigned_to === ovWho)
    && (ovStatus === "" ? true
      : ovStatus === "todo" ? t.status === "open" && t.stage !== "review"
      : ovStatus === "in_progress" ? t.status === "in_progress" && t.stage !== "review"
      : ovStatus === "review" ? t.status !== "completed" && t.stage === "review"
      : ovStatus === "done" ? t.status === "completed" && t.stage !== "cancelled"
      : ovStatus === "overdue" ? isOverdue(t)
      : ovStatus === "blocked" ? t.status !== "completed" && t.stage === "blocked"
      : ovStatus === "waiting_client" ? t.status !== "completed" && t.stage === "waiting_client"
      : ovStatus === "stale" ? isStale(t)
      : unacked(t))), todayISO);
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
    setEditing(null); setOpenHow("open"); setOpenTask(t.id); setItems(null);
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
  /* v1.315.0 (Gate 4) - the Live Host Reports submitted for this month's lives */
  const reportRows = useCachedApi<{ reports: { report_date: string; status?: string }[] }>("/staff/task-reports", canTaskReports && view === "reports", ["task_reports"]);
  const reportsAwaiting = (reportRows.data?.reports ?? []).filter((r) => (r.status ?? "submitted") !== "reviewed").length;
  /* v1.337.0 - the four views, each for whom it was drawn before: reports for task_reports,
     the team for the managing roles, the archive and the history for everyone */
  const repOptions = [
    ...(canTaskReports ? [["reports", L("Submitted Reports", "Laporan Dihantar")] as const] : []),
    ...(canManage ? [["team", L("Team Performance", "Prestasi Pasukan")] as const] : []),
    ["completed", L("Completed Tasks", "Tugasan Selesai")] as const,
    ["history", L("Task History", "Sejarah Tugasan")] as const,
  ];
  const rep = repView && repOptions.some(([k]) => k === repView) ? repView : repOptions[0]![0];
  const [repSeen, setRepSeen] = useState<Record<string, boolean>>({});
  if (view === "reports" && !repSeen[rep]) setRepSeen((x) => ({ ...x, [rep]: true }));
  const reportsThisMonth = (reportRows.data?.reports ?? []).filter((r) => r.report_date.startsWith(todayISO.slice(0, 7))).length;
  const reportsLastMonth = (reportRows.data?.reports ?? []).filter((r) => r.report_date.startsWith(plusMonth(-1))).length;
  const plusDays = (k: number) => new Date(Date.parse(`${todayISO}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const taskTabs: [TaskView, string, string][] = [
    ["overview", L("Overview", "Gambaran"), L("What needs attention now", "Apa yang perlu perhatian sekarang")],
    ["mine", L("My Tasks", "Tugasan Saya"), L("Tasks assigned to you", "Tugasan yang diberikan kepada anda")],
    ...(canManage ? [["all", L("All Tasks", "Semua Tugasan"), L("The team's task register", "Daftar tugasan pasukan")] as [TaskView, string, string]] : []),
    ...(canProjects ? [["projects", L("Projects", "Projek"), L("Delivery from accepted quotations", "Penghantaran daripada sebut harga diterima")] as [TaskView, string, string]] : []),
    ["calendar", L("Calendar", "Kalendar"), L("Deadlines, reviews, lives and milestones", "Tarikh akhir, semakan, live dan pencapaian")],
    ["reports", L("Reports & Archive", "Laporan & Arkib"), L("Operational reports and closed work", "Laporan operasi dan kerja ditutup")],
  ];
  /* ---- v1.319.0 (Tasks 2.0 Stage 1, T2-4) - THE OPEN TASK, ONE SET OF PARTS.
     Its Task Information (with Edit), its Deliverables checklist, its chips
     and its foot commands are built once here; the drawer (a phone, and
     every other tab's quick look), the task beside My Tasks (picture 2) and
     the full page (picture 4) all draw these same parts. ---- */
  const detail = (() => {
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
      if (editing.reason?.trim()) patch.reason = editing.reason.trim(); // v1.315.0 (TK-4) - why another person's task is renamed or moved
      if (await update(t.id, patch)) setEditing(null);
    };
    const subtitle = <span className={tk.badges}>
              <span className={`${PRIORITY_CHIP[t.priority] ?? chipNeutral} ${tk.cap}`}>{priorityL(t.priority)}</span>
              <StateChip status={t.status} stage={t.stage ?? null} />{/* v1.246.0 - status and stage together */}
              {t.deadline && (t.status === "completed"
                ? <span className={chipNeutral}>{t.closed_late_days ? L(`Was due ${dmy(t.deadline)} · closed ${t.closed_late_days} day(s) late`, `Sepatutnya ${dmy(t.deadline)} · ditutup lewat ${t.closed_late_days} hari`) : L(`Was due ${dmy(t.deadline)}`, `Sepatutnya ${dmy(t.deadline)}`)}</span>
                : <span className={isOverdue(t) ? chipDanger : chipNeutral}>{isOverdue(t) ? L(`Overdue — was due ${dmy(t.deadline)}`, `Lewat — sepatutnya ${dmy(t.deadline)}`) : L(`Due ${dmy(t.deadline)}`, `Perlu siap ${dmy(t.deadline)}`)}</span>)}
            </span>;
    const foot = (ackControl(t) || deleteBtn(t)) ? <span className={tk.drawerFoot}>{ackControl(t)}{deleteBtn(t)}</span> : undefined;
    const info = (<>

              <section className={tk.detailSec} aria-label={L("Task information", "Maklumat tugasan")}>
                <div className={tk.detailHead}>
                  <p className={tk.title}>{L("Task information", "Maklumat tugasan")}</p>
                  {canEdit && !editing && <button type="button" className={btnSm} onClick={startEdit}><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
                </div>
                {editing ? (
                  <div className={tk.editForm}>
                    <Sub t={L("Title *", "Tajuk *")}><input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Sub>
                    {editing.title.trim() !== t.title && t.assigned_to !== user.id && (
                      <Sub t={L("Reason for the title change *", "Sebab tajuk berubah *")}><input className={inputClass} value={editing.reason ?? ""} maxLength={300} data-testid="edit-reason" placeholder={L("e.g. the period lives in the dates", "cth. tempoh ada pada tarikh")} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} /></Sub>
                    )}
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
                      <div><dt>{L("Priority", "Keutamaan")}</dt><dd><PriorityChip priority={t.priority} /></dd></div>
                      <div><dt>{L("Start date", "Tarikh mula")}</dt><dd>{t.start_date ? dmy(t.start_date) : L("Not set", "Belum ditetapkan")}</dd></div>
                      <div><dt>{L("Due date", "Tarikh siap")}</dt><dd>{t.deadline ? dmy(t.deadline) : L("No due date", "Tiada tarikh siap")}</dd></div>
                      <div><dt>{L("Acknowledged", "Diakui")}</dt><dd>{!isAssigned(t) ? L("Not needed — self-set", "Tidak perlu — ditetapkan sendiri") : t.acknowledged ? L("Yes", "Ya") : L("Not yet", "Belum")}</dd></div>
                    </dl>
                  </>
                )}
              </section>
    </>);
    const check = (<>
              <section className={tk.detailSec} aria-label={L("Deliverables checklist", "Senarai semak hasil kerja")}>
                <div className={tk.detailHead}>
                  <p className={tk.title}>{L(`Deliverables checklist (${t.item_done ?? 0}/${t.item_count ?? 0})`, `Senarai semak hasil kerja (${t.item_done ?? 0}/${t.item_count ?? 0})`)}</p>
                </div>
                {progressBar(t)}
                {checklist(t)}
              </section>
    </>);
    return { t, subtitle, foot, info, check };
  })();
  /* v1.321.0 - the open task is drawn in one of two places: beside the My
     Tasks list from 1024px (35% list, 65% task), or the task drawer -
     every other list, and every list on a phone, where it is full screen */
  const besideOk = view === "mine" && mineMode === "list" && isLg;
  const present: "drawer" | "beside" | null = !detail ? null : openHow === "beside" ? (besideOk ? "beside" : null) : "drawer";
  /* My Tasks from 1024px always shows a task beside the list: the first of the list until one is chosen */
  const besideFirst = besideOk && loaded && (openTask == null || (openHow === "beside" && !mineRows.some((t) => t.id === openTask))) ? mineRows[0]?.id ?? null : null;
  useEffect(() => { if (besideFirst != null) void openChecklist(besideFirst, "beside"); }, [besideFirst]);
  /* a task chosen beside the list does not follow the person to a narrower screen, the board or another view */
  const besideGone = openTask != null && openHow === "beside" && !besideOk;
  useEffect(() => { if (besideGone) closeDetail(); }, [besideGone]);

  return (
    <TabPage>
      {deleteConfirmNode}
      {taskToastNode}
      <div className="erp-stack" data-testid="tasks-views">
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
        {/* v1.319.0 (Tasks 2.0 Stage 1, picture 5; T2-2) - five figures, the
            list (Table or Board) with its filters, the rail (Staff Performance
            for those who manage the team, Quick Links, Recent Activity), and
            under them the workflow as it really runs and the week's closures.
            Every figure is counted from the rows this tab loaded. */}
        {view === "overview" && (() => {
          /* v1.321.0 (the Unified Workspace brief) - a compact strip, the priority
             queue as the workspace, and ONE secondary panel the person switches.
             Every figure is still counted from the rows this tab loaded. */
          const inProg = ovOpen.filter((t) => t.status === "in_progress" && t.stage !== "review").length;
          const ovFilterN = (ovAbout ? 1 : 0) + (ovDept ? 1 : 0) + (ovWho ? 1 : 0);
          return (<>
        <MetricStrip testid="overview-strip" label={L("Task figures", "Angka tugasan")} cells={[
          { key: "total", icon: "orders", tone: "info", label: L("Total Tasks", "Jumlah Tugas"), value: ovScope.length, busy: !loaded,
            sub: L(`${ovOpen.length} open · ${ovDone.length} done`, `${ovOpen.length} terbuka · ${ovDone.length} selesai`), onClick: () => { setOvStatus(""); setOvPage(1); }, pressed: ovStatus === "" },
          { key: "overdue", icon: "warning", tone: "bad", label: L("Overdue", "Tertunggak"), value: ovOpen.filter(isOverdue).length, busy: !loaded,
            sub: L("Past due and still open", "Lepas tarikh dan masih terbuka"), onClick: () => { setOvStatus("overdue"); setOvPage(1); }, pressed: ovStatus === "overdue" },
          { key: "progress", icon: "refresh", tone: "info", label: L("In Progress", "Dalam Pelaksanaan"), value: inProg, busy: !loaded,
            sub: ovOpen.length ? L(`${Math.round((inProg / ovOpen.length) * 100)}% of open tasks`, `${Math.round((inProg / ovOpen.length) * 100)}% daripada tugasan terbuka`) : L("Being worked on", "Sedang dilaksanakan"),
            onClick: () => { setOvStatus("in_progress"); setOvPage(1); }, pressed: ovStatus === "in_progress" },
          { key: "review", icon: "pending", tone: "gold", label: L("Awaiting Review", "Menunggu Semakan"), value: ovOpen.filter((t) => t.stage === "review").length, busy: !loaded,
            sub: canManage ? L("Submitted for review, in your scope", "Dihantar untuk semakan, dalam skop anda") : L("Yours, waiting for the reviewer", "Milik anda, menunggu penyemak"),
            onClick: () => { setOvStatus("review"); setOvPage(1); }, pressed: ovStatus === "review" },
          { key: "done", icon: "success", tone: "ok", label: L("Done", "Selesai"), value: ovDone.length, busy: !loaded,
            sub: L(`${closedThisWeek(ovDone, todayISO)} closed this week`, `${closedThisWeek(ovDone, todayISO)} ditutup minggu ini`), onClick: () => { setOvStatus("done"); setOvPage(1); }, pressed: ovStatus === "done" },
        ]} />
        <div className={t2.ovGrid}>
          <section className={`${card} ${t2.listCard}`} aria-label={L("Priority queue", "Barisan keutamaan")} data-testid="overview-list">
            <Head2 icon="orders" title={L("Priority Queue", "Barisan Keutamaan")}
              sub={L("Overdue and blocked first, then the soonest due.", "Lewat dan terhalang dahulu, kemudian yang paling hampir.")} aside={
              <>
                <PillSwitch testid="overview-mode" label={L("View", "Paparan")} value={ovMode} onChange={setOvMode}
                  options={[["table", L("Table", "Jadual"), "orders"], ["board", L("Board", "Kanban"), "chart"]] as const} />
                <button type="button" className={btnSm} onClick={() => go("calendar")} aria-label={L("Open the calendar", "Buka kalendar")} title={L("Calendar", "Kalendar")}><AppIcon name="date" /></button>
              </>
            } />
            <div className={t2.filters} role="search" data-testid="overview-filters">
              <select className={inputClassSm} aria-label={L("Status", "Status")} value={ovStatus} onChange={(e) => { setOvStatus(e.target.value as OvStatus); setOvPage(1); }}>
                <option value="">{L("All status", "Semua Status")}</option>
                <option value="todo">{L("To Do", "Belum Mula")}</option>
                <option value="in_progress">{L("In Progress", "Sedang Berjalan")}</option>
                <option value="review">{L("Review", "Semakan")}</option>
                <option value="done">{L("Done", "Selesai")}</option>
                <option value="overdue">{L("Overdue", "Lewat")}</option>
                <option value="blocked">{L("Blocked", "Terhalang")}</option>
                <option value="waiting_client">{L("Waiting for Client", "Menunggu Pelanggan")}</option>
                <option value="stale">{L("No recent update", "Tiada kemas kini terkini")}</option>
                <option value="unacked">{L("Not acknowledged", "Belum diakui")}</option>
              </select>
              {(abouts.length > 0 || canManage) && (
                <FilterPopover testid="overview-more" count={ovFilterN} onClear={() => { setOvAbout(""); setOvDept(""); setOvWho(0); setOvPage(1); }}>
                  {abouts.length > 0 && (
                    <FilterField label={L("Project or customer", "Projek atau pelanggan")}>
                      <select className={inputClassSm} value={ovAbout} onChange={(e) => { setOvAbout(e.target.value); setOvPage(1); }}>
                        <option value="">{L("All projects", "Semua Projek")}</option>
                        {abouts.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </FilterField>
                  )}
                  {canManage && ovDepts.length > 0 && (
                    <FilterField label={L("Department", "Jabatan")}>
                      <select className={inputClassSm} value={ovDept} onChange={(e) => { setOvDept(e.target.value); setOvPage(1); }}>
                        <option value="">{L("All departments", "Semua Jabatan")}</option>
                        {ovDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </FilterField>
                  )}
                  {canManage && (
                    <FilterField label={L("Staff", "Staf")}>
                      <select className={inputClassSm} value={ovWho} onChange={(e) => { setOvWho(Number(e.target.value)); setOvPage(1); }}>
                        <option value={0}>{L("All staff", "Semua Staf")}</option>
                        {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </FilterField>
                  )}
                </FilterPopover>
              )}
              <span className={t2.found} data-testid="overview-found">{loaded ? L(`${ovRows.length} task(s) found`, `${ovRows.length} tugasan dijumpai`) : ""}</span>
            </div>
            {!loaded ? <SkelRows rows={5} /> : ovRows.length === 0 ? (
              <p className={tk.empty}><AppIcon name={ovScope.length ? "search" : "success"} />{ovScope.length ? L("No task matches these filters.", "Tiada tugasan sepadan dengan penapis ini.") : L("No tasks yet. Create Task starts the first one.", "Belum ada tugasan. Cipta Tugas memulakan yang pertama.")}</p>
            ) : ovMode === "table" ? (<>
              <FillPanel testid="overview-fill"><OverviewTable rows={ovRows.slice((Math.min(ovPage, Math.ceil(ovRows.length / ovSize)) - 1) * ovSize, Math.min(ovPage, Math.ceil(ovRows.length / ovSize)) * ovSize)} today={todayISO} showWho={canManage} onOpen={(id) => void openChecklist(id)} label={L("Priority queue", "Barisan keutamaan")} /></FillPanel>
              <PaginationControls testid="overview-pages" page={ovPage} total={ovRows.length} size={ovSize} onPage={setOvPage} onSize={(n) => { setOvSize(n); setOvPage(1); }} label={L("Priority queue pages", "Halaman barisan keutamaan")} />
            </>) : (<>
              <FlowBoard rows={ovRows} today={todayISO} showWho={canManage} limit={3} onOpen={(id) => void openChecklist(id)} onAdd={() => setCreateOpen(true)} onAllDone={() => go("reports", "task-archive")} />
              <div className={t2.more}>
                <span className={t2.note}>{L("Up to three per column - the most pressing first", "Sehingga tiga setiap lajur - paling mendesak dahulu")}</span>
                <button type="button" className={btnSm} onClick={() => { clearFilters(); go(canManage ? "all" : "mine"); }}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>
              </div>
            </>)}
          </section>
          {/* ONE secondary panel: the person picks what sits beside the queue */}
          <div className={t2.rail} data-testid="overview-panel" data-panel={ovPanel}>
            <div data-testid="overview-panel-switch">
              {/* v1.323.0 (D-2) - three different contents, so three tabs: the one tab row, never a pill */}
              <LineTabs label={L("Beside the queue", "Di sebelah barisan")} value={ovPanel} onChange={setOvPanel} tabs={[
                ["people", canManage ? L("Staff", "Staf") : L("My Today", "Hari Ini")],
                ["activity", L("Activity", "Aktiviti")],
                ["actions", L("Actions", "Tindakan")],
              ] as const} />
            </div>
            {/* v1.323.0 (D-4) - the queue and its panel fill the screen side by side; each scrolls inside */}
            <FillPanel testid="overview-panel-body" className={t2.railBody}>
            {ovPanel === "people" && (<>
              {canManage
                ? <StaffPerformance tasks={tasks} today={todayISO} onPick={(id) => { clearFilters(); setWhoF(id); setStatusF("any"); go("all"); }} />
                : <MyToday mine={myTasks} today={todayISO} onAll={() => { clearFilters(); go("mine"); }} />}
              <WeeklySummary tasks={ovScope} today={todayISO} />
            </>)}
            {ovPanel === "activity" && <ActivityFeed rows={ovScope} onOpen={(id) => void openChecklist(id)} />}
            {ovPanel === "actions" && (<>
              <QuickLinks items={[
                { icon: "add", label: L("Create Task", "Cipta Tugas"), onClick: () => setCreateOpen(true), testid: "ql-create" },
                ...(canProjects ? [{ icon: "folder" as const, label: L("Projects", "Projek"), onClick: () => go("projects") }] : []),
                canManage ? { icon: "users" as const, label: L("Staff Tasks", "Tugasan Staf"), onClick: () => { clearFilters(); go("all"); } } : { icon: "assignment" as const, label: L("My Tasks", "Tugasan Saya"), onClick: () => { clearFilters(); go("mine"); } },
                { icon: "chart", label: L("Reports", "Laporan"), onClick: () => go("reports") },
              ]} />
              <WorkflowStrip />
            </>)}
            </FillPanel>
          </div>
        </div>
          </>);
        })()}
      </TabZone>

      {/* ============================== MY TASKS ============================== */}
      {/* v1.313.0 - TASKS 5.0 (image 1): four figures of your own work, the
          one list (List or Board) with the selected task beside it from
          1280px, and the four cards under it - your focus, today's agenda
          from the roster, what is due in seven days, the latest updates */}
      <TabZone label={L("My work", "Kerja saya")} className={view !== "mine" ? tk.off : ""}>
      {/* v1.321.0 (the Unified Workspace brief) - four figures in one compact strip */}
      <MetricStrip testid="mine-strip" label={L("My task figures", "Angka tugasan saya")} cells={[
        { key: "assigned", icon: "orders", tone: "info", label: L("Assigned Tasks", "Tugasan Ditetapkan"), value: myActive.length, busy: !loaded,
          sub: L("Open tasks that are yours", "Jumlah tugasan untuk saya"), onClick: () => { clearFilters(); } },
        { key: "progress", icon: "next", tone: "ok", label: L("In Progress", "Dalam Proses"), value: myActive.filter((t) => t.status === "in_progress").length, busy: !loaded,
          sub: L("Being worked on", "Sedang dilaksanakan"), onClick: () => { clearFilters(); setStatusF("in_progress"); }, pressed: statusF === "in_progress" },
        { key: "soon", icon: "warning", tone: myActive.some(isOverdue) ? "bad" : "gold", label: L("Due Soon", "Hampir Tarikh Akhir"), value: myActive.filter((t) => t.deadline && t.deadline >= todayISO && t.deadline <= plusDays(3)).length, busy: !loaded,
          sub: myActive.some(isOverdue) ? L(`Due in 3 days · ${myActive.filter(isOverdue).length} overdue`, `Dalam 3 hari · ${myActive.filter(isOverdue).length} lewat`) : L("Due in the next 3 days", "Perlu siap dalam 3 hari"),
          onClick: () => { clearFilters(); setSortK("deadline"); }, pressed: sortK === "deadline" && statusF === "active" },
        { key: "week", icon: "success", tone: "neutral", label: L("Done This Week", "Selesai Minggu Ini"), value: myTasks.filter((t) => t.status === "completed" && t.stage !== "cancelled" && (t.closed_at ?? "").slice(0, 10) >= mondayOf(todayISO)).length, busy: !loaded,
          sub: L("Tasks you closed (Mon - Sun)", "Tugasan anda tutup (Isn - Ahd)"), onClick: () => go("reports", "task-archive") },
      ]} />
      {view === "mine" && (() => {
        /* Board · List, and the Calendar tab one press away */
        const modeRow = (
          <PillSwitch testid="mine-mode" label={L("View", "Paparan")} value={mineMode}
            onChange={(k: "list" | "board" | "calendar") => { if (k === "calendar") go("calendar"); else { if (k === "board" && openHow === "beside") closeDetail(); setMineMode(k); } }}
            options={[["list", L("List", "Senarai"), "orders"], ["board", L("Board", "Papan"), "chart"], ["calendar", L("Calendar", "Kalendar"), "date"]] as const} />
        );
        const subMine = L("Tasks assigned to you. Update progress, manage subtasks, and request closure.", "Tugasan yang diberikan kepada anda. Kemas kini kemajuan, urus subtugasan, dan mohon penutupan.");
        const noMatch = statusF === "active" && !needle && !prioF ? caughtUp : <p className={tk.empty}><AppIcon name="search" />{L("No task matches — clear the search or a filter.", "Tiada tugasan sepadan — kosongkan carian atau penapis.")}</p>;
        if (mineMode === "board") return (
          <div className={`${card} ${t2.listCard}`} data-testid="mine-board">
            <Head2 icon="orders" title={<>{L("My Tasks", "Tugasan Saya")}<span className={t2.count}>{sift(myTasks).length}</span></>} sub={subMine} aside={modeRow} />
            {toolbar(false, false)}
            {!loaded ? <SkelRows rows={4} /> : <FlowBoard rows={sift(myTasks)} today={todayISO} showWho={canManage} onOpen={(id) => void openChecklist(id)} onAdd={() => setCreateOpen(true)} onAllDone={() => go("reports", "task-archive")} foot={(t) => <>{ackControl(t)}{deleteBtn(t)}</>} />}
          </div>
        );
        const list = (
          <section className={`${card} ${t2.listCard}`} aria-label={L("My Tasks", "Tugasan Saya")} data-testid="mine-list">
            <Head2 icon={besideOk ? undefined : "orders"} title={<>{L("My Tasks", "Tugasan Saya")}<span className={t2.count}>{mineRows.length}</span></>} sub={besideOk ? undefined : subMine} aside={modeRow} />
            {toolbar(false, true, true)}
            {besideOk
              ? <MyTaskTable rows={mineRows} picked={present === "beside" ? openTask : null} onPick={(id) => void openChecklist(id, "beside")} today={todayISO} loaded={loaded} empty={noMatch}
                  sort={sortK} dir={sortDirOf(sortK, sortRev)} onSort={(k) => sortBy(k as SortK)}
                  page={minePage} size={mineSize} onPage={setMinePage} onSize={(n) => { setMineSize(n); setMinePage(1); }} />
              : <MyTaskCards rows={mineRows} picked={null} onPick={(id) => void openChecklist(id, "open")} today={todayISO} loaded={loaded} empty={noMatch} />}
          </section>
        );
        /* below 1024px: the full-width list; a task opens full screen in the drawer */
        if (!besideOk) return list;
        /* from 1024px: the register (40%) and the chosen task (60%), together held to the
           screen (FillPanel): each column scrolls inside, both end on one line (v1.326.0) */
        return (
          <FillPanel className={t2.mine} testid="mine-split">
            {list}
            {present === "beside" && detail ? (
              <TaskWorkspace key={detail.t.id} layout="pane" taskId={detail.t.id} info={detail.info} checklist={detail.check} foot={detail.foot}
                focusForm={sheetFor === detail.t.id} onChanged={() => { setSheetFor(null); void load(); }} />
            ) : (
              <section className={card} data-testid="mine-none">{!loaded ? <SkelRows rows={6} /> : <p className={tk.empty}><AppIcon name="info" />{mineRows.length ? L("Choose a task on the left to see it here.", "Pilih tugasan di kiri untuk melihatnya di sini.") : L("No task to show.", "Tiada tugasan untuk dipaparkan.")}</p>}</section>
            )}
          </FillPanel>
        );
      })()}
      {/* My Day (your focus, today's agenda, what is due in seven days, the latest
          updates) - kept whole, folded under the list so the list leads */}
      {view === "mine" && (
        <details className={t2.disclose} data-testid="my-day">
          <summary><AppIcon name="date" />{L("My Day — focus, agenda, due this week, latest updates", "Hari Saya — fokus, agenda, perlu siap minggu ini, kemas kini terkini")}</summary>
          <MyDayCards mine={myTasks} today={todayISO} userId={user.id} onOpen={(id) => void openChecklist(id)} onArchive={() => go("reports", "task-archive")} />
        </details>
      )}
      </TabZone>

      {/* ============================== ALL TASKS ============================== */}
      {/* v1.313.0 - TASKS 5.0 (image 3): five figures, the register with Edit
          on each row (the existing Edit: title, dates, priority, assignee -
          the server decides who may), and beside it the workload, the
          departments and the tasks waiting for review */}
      {canManage && (
      <TabZone label={L("The work", "Kerja")} className={view !== "all" ? tk.off : ""}>
      {/* v1.321.0 (the Unified Workspace brief) - five figures in one strip, ONE
          register (a compact table with the toolbar above it), and the
          workforce analytics behind Insights. Every row command is kept. */}
      <MetricStrip testid="all-strip" label={L("Task register figures", "Angka daftar tugasan")} cells={[
        { key: "open", icon: "orders", tone: "info", label: L("Open Tasks", "Tugasan Terbuka"), value: openTasks.length, busy: !loaded,
          sub: L("All active and unclosed tasks", "Semua tugasan aktif dan belum ditutup"), onClick: () => { clearFilters(); setStatusF("active"); }, pressed: statusF === "active" && !filtering },
        { key: "progress", icon: "pending", tone: "gold", label: L("In Progress", "Sedang Berjalan"), value: pendingCount, busy: !loaded,
          sub: L("Currently being worked on", "Sedang diusahakan"), onClick: () => { clearFilters(); setStatusF("in_progress"); }, pressed: statusF === "in_progress" },
        { key: "review", icon: "time", tone: "neutral", label: L("Waiting Review", "Menunggu Semakan"), value: openTasks.filter((t) => t.stage === "review").length, busy: !loaded,
          sub: L("Submitted, awaiting approval", "Dihantar, menunggu kelulusan"), onClick: () => { clearFilters(); setStatusF("review"); }, pressed: statusF === "review" },
        { key: "overdue", icon: "warning", tone: "bad", label: L("Overdue", "Lewat"), value: overdueCount, busy: !loaded,
          sub: L("Past due and require attention", "Lepas tarikh dan perlu perhatian"), onClick: () => { clearFilters(); setStatusF("overdue"); }, pressed: statusF === "overdue" },
        { key: "week", icon: "success", tone: "ok", label: L("Closed This Week", "Ditutup Minggu Ini"), value: tasks.filter((t) => t.status === "completed" && t.stage !== "cancelled" && (t.closed_at ?? "").slice(0, 10) >= mondayOf(todayISO)).length, busy: !loaded,
          sub: L("Closed Mon - Sun", "Ditutup Isn - Ahd"), onClick: () => go("reports", "task-archive") },
      ]} />
      {(() => {
        const rows = sift(tasks, { status: true, who: true, more: true });
        const subAll = L("Company-wide task register, scoped to your role. Manage, update, and track progress across all tasks.", "Daftar tugasan seluruh syarikat, mengikut peranan anda. Urus, kemas kini dan jejak kemajuan semua tugasan.");
        const cols = allCols();
        const moreN = (aboutF ? 1 : 0) + (prioF ? 1 : 0) + (whoF ? 1 : 0) + (deptF ? 1 : 0) + (dueFrom ? 1 : 0) + (dueTo ? 1 : 0);
        return (
          <section className={`${card} ${t2.listCard}`} aria-label={L("All Tasks", "Semua Tugasan")} data-testid="all-register">
            <Head2 icon="orders" title={<>{L("All Tasks", "Semua Tugasan")}<span className={t2.count}>{loaded ? rows.length : ""}</span></>} sub={subAll} aside={
              <>
                <PillSwitch testid="all-mode" label={L("View", "Paparan")} value={allMode} onChange={setAllMode}
                  options={[["list", L("List", "Senarai"), "orders"], ["board", L("Board", "Papan"), "chart"]] as const} />
                <button type="button" className={btnSm} aria-pressed={insights} onClick={() => setInsights((v) => !v)} data-testid="insights-btn"><AppIcon name="chart" />{L("Insights", "Wawasan")}</button>
              </>
            } />
            <TaskToolbar q={q} onQ={(v) => { setQ(v); setAllPage(1); }} placeholder={L("Search title, description or staff…", "Cari tajuk, keterangan atau kakitangan…")}
              aside={<>
                <FilterPopover testid="all-filters" count={moreN} onClear={() => { setAboutF(""); setPrioF(""); setWhoF(0); setDeptF(""); setDueFrom(""); setDueTo(""); setAllPage(1); }}>
                  <FilterField label={L("Department", "Jabatan")}>
                    <select className={inputClassSm} value={deptF} onChange={(e) => { setDeptF(e.target.value); setAllPage(1); }}>
                      <option value="">{L("All departments", "Semua jabatan")}</option>
                      {allDepts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </FilterField>
                  <FilterField label={L("Assigned to", "Diberikan kepada")}>
                    <select className={inputClassSm} value={whoF} onChange={(e) => { setWhoF(Number(e.target.value)); setAllPage(1); }}>
                      <option value={0}>{L("Everyone", "Semua orang")}</option>
                      {assignees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </FilterField>
                  {abouts.length > 0 && (
                    <FilterField label={L("Project or customer", "Projek atau pelanggan")}>
                      <select className={inputClassSm} value={aboutF} onChange={(e) => { setAboutF(e.target.value); setAllPage(1); }}>
                        <option value="">{L("All projects and customers", "Semua projek dan pelanggan")}</option>
                        {abouts.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </FilterField>
                  )}
                  <FilterField label={L("Priority", "Keutamaan")}>
                    <select className={inputClassSm} value={prioF} onChange={(e) => { setPrioF(e.target.value); setAllPage(1); }}>
                      <option value="">{L("All priorities", "Semua keutamaan")}</option>
                      {["urgent", "high", "normal", "low"].map((x) => <option key={x} value={x}>{priorityL(x)}</option>)}
                    </select>
                  </FilterField>
                  <FilterField label={L("Due from", "Tarikh akhir dari")}><input type="date" className={inputClassSm} value={dueFrom} max={dueTo || undefined} onChange={(e) => { setDueFrom(e.target.value); setAllPage(1); }} data-testid="due-from" /></FilterField>
                  <FilterField label={L("Due until", "Tarikh akhir hingga")}><input type="date" className={inputClassSm} value={dueTo} min={dueFrom || undefined} onChange={(e) => { setDueTo(e.target.value); setAllPage(1); }} data-testid="due-to" /></FilterField>
                </FilterPopover>
                {allMode === "list" && <ColumnPicker cols={cols} hidden={hiddenCols} onToggle={(k) => setHiddenCols((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />}
                {filtering && <button type="button" className={btnSm} onClick={clearFilters}>{L("Clear", "Kosongkan")}</button>}
              </>}>
              {statusFilter}
            </TaskToolbar>
            {insights && (
              <div className={t2.insights} data-testid="all-insights">
                <WorkloadCard tasks={tasks} onPick={(id) => { clearFilters(); setWhoF(id); }} />
                <DepartmentCard tasks={tasks} deptOf={deptOf} />
                <QuickApprovals tasks={tasks} onOpen={(id) => void openChecklist(id)} onAll={() => { clearFilters(); setStatusF("review"); }} />
              </div>
            )}
            {allMode === "list" ? (
              <CompactTaskTable rows={rows} cols={cols} label={L("All Tasks", "Semua Tugasan")} loading={!loaded} hidden={hiddenCols}
                sort={sortK} dir={sortDirOf(sortK, sortRev)} onSort={(k) => sortBy(k as SortK)} onOpen={(id) => void openChecklist(id)}
                rowClass={(t) => (isOverdue(t) ? tk.rowOverdue ?? "" : "")}
                page={allPage} size={allSize} onPage={setAllPage} onSize={(n) => { setAllSize(n); setAllPage(1); }}
                empty={<p className={tk.empty}><AppIcon name="search" />{L("No task matches — clear the search or a filter.", "Tiada tugasan sepadan — kosongkan carian atau penapis.")}</p>} />
            ) : (
              !loaded ? <SkelRows rows={4} /> : <FlowBoard rows={rows} today={todayISO} showWho onOpen={(id) => void openChecklist(id)} onAdd={() => setCreateOpen(true)} onAllDone={() => go("reports", "task-archive")} foot={(t) => <>{ackControl(t)}{deleteBtn(t)}</>} />
            )}
          </section>
        );
      })()}
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

      {/* v1.328.0 - R-1 (the CEO, 16-11-2026): the operational roster - Today's
          assignments and the Roster Board - moved whole to People > Roster &
          Scheduling, with the same gates. The calendar keeps tasks, deadlines,
          reviews and project milestones; one line points to the roster. */}
      {view === "calendar" && (
        <p className={tk.rosterLink} data-testid="cal-roster-link">
          <AppIcon name="date" />{L("Lives, shifts and sales duty are planned on Roster & Scheduling.", "Live, syif dan tugas jualan dirancang di Roster & Penjadualan.")}
          <button type="button" className={btnSm} onClick={() => openTab("Roster & Scheduling")}>{L("Open Roster & Scheduling", "Buka Roster & Penjadualan")}</button>
        </p>
      )}

      {/* ============================== PROJECTS ============================== */}
      {/* v1.245.0 - the project briefs: no new sidebar item, they live here
          and on their quotation's page in Sales (the owner's brief) */}
      <TabZone label={L("Project briefs", "Ringkasan projek")} className={view !== "projects" ? tk.off : ""}>
        {canProjects && view === "projects" && <ProjectsBoard openId={projOpen} onOpen={setProjOpen} />}
      </TabZone>

      {/* ============================ REPORTS & ARCHIVE ============================ */}
      {/* v1.313.0 - TASKS 5.0 (image 5). v1.337.0 - FOUR FOCUSED VIEWS, ONE AT A TIME (the
          CEO, 17-11-2026: "Reorganize Reports & Archive into focused views: Submitted Reports,
          Team Performance, Completed Tasks and Task History. Show only the active view ...
          Move Submit Report into a clickable modal/drawer"). One connected strip, one view
          switch, the chosen view; each view stays mounted once opened and is hidden, never
          unmounted. The task email settings left for System > Automation & Rules (one link). */}
      <TabZone label={L("Reports and archive", "Laporan dan arkib")} className={view !== "reports" ? tk.off : ""}>
        <KpiRow label={L("Reports figures", "Angka laporan")} testid="reports-strip">
          <KpiTile icon="documents" tone="blue" label={L("Reports Submitted", "Laporan Dihantar")} value={canTaskReports ? reportsThisMonth : "—"} busy={canTaskReports && reportRows.loading && !reportRows.data} cell="submitted"
            sub={canTaskReports ? L(`This month · ${reportsLastMonth} last month`, `Bulan ini · ${reportsLastMonth} bulan lepas`) : L("Read by management", "Dibaca oleh pengurusan")} onClick={canTaskReports ? () => setRepView("reports") : undefined} />
          <KpiTile icon="time" tone="gold" label={L("Awaiting Review", "Menunggu Semakan")} value={canTaskReports ? reportsAwaiting : "—"} busy={canTaskReports && reportRows.loading && !reportRows.data} cell="awaiting"
            sub={canTaskReports ? L("Reports not yet reviewed by management", "Laporan belum disemak pengurusan") : L("Read by management", "Dibaca oleh pengurusan")} onClick={canTaskReports ? () => setRepView("reports") : undefined} />
          <KpiTile icon="folder" tone="green" label={L("Archived Tasks", "Tugasan Diarkibkan")} value={closed.length + older.filter((o) => !tasks.some((t) => t.id === o.id)).length} busy={!loaded} cell="archived"
            sub={L("Completed records", "Rekod selesai")} onClick={() => setRepView("completed")} />
          <KpiTile icon="warning" tone="red" label={L("Task Attention", "Perhatian Tugasan")} value={(canManage ? tasks : myTasks).filter(isOverdue).length} busy={!loaded} cell="attention"
            sub={L("Overdue tasks", "Tugasan lewat")} onClick={() => { clearFilters(); setStatusF("overdue"); go(canManage ? "all" : "mine"); }} />
        </KpiRow>
        <div className={tk.repBar}>
          <PillSwitch testid="rep-view" label={L("Reports & Archive view", "Paparan Laporan & Arkib")} value={rep} onChange={setRepView} options={repOptions} />
          {["ceo", "coo", "cco", "super_admin"].includes(user.role) && (
            <button type="button" className={btnSm} onClick={() => { openTab("Automation & Rules"); setTabStart({ tab: "Automation & Rules", view: "email" }); }} data-testid="task-email-settings">
              <AppIcon name="chat" />{L("Task email settings", "Tetapan e-mel tugasan")}</button>
          )}
        </div>
        {/* Submitted Reports - the register, the chosen report, Submit Report in a drawer */}
        <div hidden={rep !== "reports"} id="task-reports" data-testid="task-reports">
          {canTaskReports && reportsSeen ? (
            <TaskReports />
          ) : <section className={card} aria-label={L("Operational reports", "Laporan operasi")}><Head5 icon="documents" title={L("Operational Reports", "Laporan Operasi")} sub={L("Daily, weekly and monthly reports are written and read by management.", "Laporan harian, mingguan dan bulanan ditulis dan dibaca oleh pengurusan.")} /></section>}
        </div>
        {/* Team Performance - the company-wide card and each person's tasks (management roles) */}
        {canManage && (
          <div hidden={rep !== "team"} className={tk.repStack} data-testid="team-performance">
            {progress}
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
          </div>
        )}
        {/* Completed Tasks - the archive, searchable, paged, older ones on a press */}
        <div hidden={rep !== "completed"} id="task-archive">
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
        {/* Task History - each task's recorded story (the existing activity read) */}
        <div hidden={rep !== "history"} data-testid="task-history">
          {repSeen.history && <TaskHistory tasks={[...tasks, ...older.filter((o) => !tasks.some((t) => t.id === o.id))]} loading={!loaded}
            onOpenTask={(id) => { const t = [...tasks, ...older].find((x) => x.id === id); if (t) { openList(t); setEditing(null); setOpenHow("open"); setOpenTask(t.id); setItems(null); } }} />}
        </div>
      </TabZone>
      </div>
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
      {/* v1.321.0 - TaskDetailDrawer: the same task pane as beside My Tasks
          (Details, Checklist, Updates, Files, Activity and the one composer),
          full screen on a phone */}
      {detail && present === "drawer" && (
        <TaskDetailDrawer taskId={detail.t.id} title={detail.t.title} subtitle={detail.subtitle} info={detail.info} checklist={detail.check} foot={detail.foot}
          focusForm={sheetFor === detail.t.id} onClose={closeDetail} onChanged={() => { setSheetFor(null); void load(); }} />
      )}
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
