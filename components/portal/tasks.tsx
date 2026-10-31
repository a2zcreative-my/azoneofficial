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
import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { Sub } from "@/components/portal/leave";
import { L, MANAGE_ROLES, Task, TaskItem, User, priorityL } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { taskFigures } from "@/lib/task-figures"; // v1.203.0
import { btnClass, btnSm, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { dmy } from "@/lib/format";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
import { SideDrawer } from "@/components/ui/side-drawer";
import tk from "./tasks-page.module.css";

/* v1.209.0 - Create left the tab row for a drawer from the + button (the
   owner's Tasks brief, 25-10-2026); Calendar joined it, drawn from the
   deadlines already loaded. */
type TaskView = "overview" | "mine" | "all" | "calendar" | "reports";
type StatusF = "active" | "open" | "in_progress" | "completed" | "any";
type SortK = "newest" | "deadline" | "priority" | "title" | "progress";
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_CHIP: Record<string, string> = { urgent: chipDanger, high: chipWarn, normal: chipInfo, low: chipNeutral };
/** rows on one page of the All Tasks and archive tables */
const PER = 15;
const statusL = (v: string) => v === "completed" ? L("Closed", "Selesai") : v === "in_progress" ? L("Pending", "Menunggu") : L("Open", "Terbuka");

/* ================= Tasks ================= */

export function Tasks({ user, progress, initialView, focus }: { user: User; progress?: ReactNode; initialView?: string; focus?: RecordFocus | null }) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    scope: "", // v1.42.0 — one deliverable per line → tickable task_items
    assigned_to: 0,
    priority: "normal",
    deadline: "",
  });
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [items, setItems] = useState<TaskItem[] | null>(null);
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
  const roster = useCachedApi<{ staff: { id: number; name: string; role?: string; position?: string | null }[] }>("/staff/staff-list", canManage, ["users"]);
  const team = useMemo(() => roster.data?.staff ?? [], [roster.data]);
  const refreshBoard = board.refresh;
  const load = useCallback(async () => { refreshBoard(); }, [refreshBoard]);

  /* v1.203.0 - a Dashboard quick action may open a tab straight on its form */
  const [view, setView] = useState<TaskView>(() => (["overview", "mine", "all", "calendar", "reports"].includes(initialView ?? "") ? initialView as TaskView : "overview"));
  /* the Dashboard's "Create task" still opens the form: it is a drawer now */
  const [createOpen, setCreateOpen] = useState(() => initialView === "create");
  /* v1.209.0 - THE TASK DRAWER: one task, its facts, its checklist and the
     commands the row always had. `openTask` (which checklist is loaded) is
     the drawer's task. */
  const [editing, setEditing] = useState<null | { title: string; description: string; priority: string; deadline: string; assigned_to: number }>(null);
  const go = (v: TaskView, anchor?: string) => {
    setView(v);
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };

  const create = async () => {
    if (!draft.title) return;
    // Staff self-assign; managers may pick someone. 0 = self on the server.
    const payload = {
      ...draft,
      assigned_to: draft.assigned_to || undefined,
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
      showTaskToast(L("Not created", "Tidak dibuat"), L("The task did not reach the server — try again", "Tugasan itu tidak sampai ke pelayan — cuba lagi"), "notice");
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
      deadline: "",
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
  const closeDetail = () => { setOpenTask(null); setItems(null); setEditing(null); };
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
  const isMine = (t: Task) => t.assigned_to === undefined || t.assigned_to === user.id;
  const isAssigned = (t: Task) => t.created_by != null && t.assigned_to != null && t.created_by !== t.assigned_to;
  const unacked = (t: Task) => isAssigned(t) && t.acknowledged === 0 && t.status !== "completed";

  const statusSelect = (t: Task) => (
    <select
      className={selectClassSm}
      aria-label={`${L("Status", "Status")} — ${t.title}`}
      value={t.status}
      onChange={(e) =>
        void update(t.id, {
          status: e.target.value,
          progress:
            e.target.value === "completed" ? 100 : t.progress,
        })
      }
    >
      {[
        ["open", "Open"],
        ["in_progress", "Pending"],
        ["completed", "Closed"],
      ].map(([v, lbl]) => (
        <option key={v} value={v}>
          {L(
            lbl!,
            v === "open"
              ? "Terbuka"
              : v === "in_progress"
                ? "Menunggu"
                : "Selesai"
          )}
        </option>
      ))}
    </select>
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
  const linkChip = (t: Task) => t.link_kind && t.link_id ? (
    <span className={chipInfo}>{({ customer: L("Customer", "Pelanggan"), enquiry: L("Enquiry", "Pertanyaan"), quotation: L("Quotation", "Sebut harga"), recovery: L("Recovery plan", "Pelan pemulihan") } as Record<string, string>)[t.link_kind] ?? t.link_kind} #{t.link_id}</span>
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
  const checklist = (t: Task) => {
    const mine = isMine(t);
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
        {items && items.map((it) => (
          <label key={it.id} className={tk.item}>
            <input
              type="checkbox"
              checked={it.done === 1}
              disabled={!mine && !canManage}
              onChange={() => void toggleItem(t.id, it.id)}
            />
            <span className={it.done ? tk.itemDone : ""}>
              {it.title}
              {it.done === 1 && it.done_by_name ? (
                <span className={tk.itemBy}>
                  — {it.done_by_name}{it.done_at ? ` · ${it.done_at.slice(0, 10)}` : ""}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    );
  };

  /* ---- the toolbar every list shares ---- */
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<StatusF>("active");
  const [prioF, setPrioF] = useState("");
  const [whoF, setWhoF] = useState<number>(0);
  const [sortK, setSortK] = useState<SortK>("newest");
  const [mineMode, setMineMode] = useState<"list" | "board">("list");
  const [allMode, setAllMode] = useState<"list" | "board">("list");
  const [allPage, setAllPage] = useState(1);
  const [archPage, setArchPage] = useState(1);
  /* the Calendar's month, Malaysia time */
  const [calMonth, setCalMonth] = useState(() => todayISO.slice(0, 7));
  /* a person's position, from the picker list the form already reads */
  const positionOf = (id?: number) => {
    const u = id == null ? undefined : team.find((x) => x.id === id);
    return u ? (u.position || (u.role ?? "").replace(/_/g, " ")) : "";
  };
  const [archQ, setArchQ] = useState("");
  const needle = q.trim().toLowerCase();
  const sift = (rows: Task[], opts: { status?: boolean; who?: boolean } = {}) => rows
    .filter((t) => !opts.status ? true
      : statusF === "any" ? true : statusF === "active" ? t.status !== "completed" : t.status === statusF)
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
  const filtering = !!(needle || prioF || whoF || statusF !== "active");
  const clearFilters = () => { setQ(""); setPrioF(""); setWhoF(0); setStatusF("active"); setSortK("newest"); setAllPage(1); };
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
          <option value="active">{L("Active (open + pending)", "Aktif (terbuka + menunggu)")}</option>
          <option value="open">{L("Open", "Terbuka")}</option>
          <option value="in_progress">{L("Pending", "Menunggu")}</option>
          <option value="completed">{L("Closed", "Selesai")}</option>
          <option value="any">{L("All statuses", "Semua status")}</option>
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
  const renderTasks = (rows: Task[], title: string, pending = false, opts: { who?: boolean; empty?: ReactNode; sub?: ReactNode; tools?: ReactNode; id?: string; pager?: { page: number; set: (n: number) => void } } = {}) => {
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
          <table className={tk.table} aria-label={title}>
            <thead>
              <tr>
                <th>{L("Task", "Tugasan")}</th>
                {opts.who && <th>{L("Assigned to", "Diberikan kepada")}</th>}
                {opts.who && <th>{L("Position", "Jawatan")}</th>}
                <th>{L("Priority", "Keutamaan")}</th>
                <th>{L("Deadline", "Tarikh akhir")}</th>
                <th>{L("Status", "Status")}</th>
                <th>{L("Progress", "Kemajuan")}</th>
                {canDelete && <th><span className={tk.srOnly}>{L("Delete", "Padam")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                /* v1.42.0: the list is a monitoring surface — an overdue task is
                   RED before anyone reads a date, an unacknowledged assignment
                   wears an amber badge, and the scope tally shows how far along
                   the work actually is. */
                const overdue = isOverdue(t);
                return (
                  <tr key={t.id} data-record={`task:${t.id}`} className={overdue ? tk.rowOverdue : ""}>
                    <td className={tk.taskCell} data-label={L("Task", "Tugasan")}>
                      <button type="button" className={`${tk.taskTitle} ${tk.titleBtn} ${overdue ? tk.danger : ""}`} onClick={() => void openChecklist(t.id)}>{t.title}</button>
                      {/* v1.152.2 (the CEO's kept-lines sweep): the description was
                          typed, saved, and shown NOWHERE - the row listed everything
                          about a task except what it said. Its lines are kept. */}
                      {t.description && (
                        <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">{t.description}</p>
                      )}
                      <span className={tk.badges}>{linkChip(t)}{scopeChip(t)}{ackControl(t)}</span>
                    </td>
                    {opts.who && (
                      <td data-label={L("Assigned to", "Diberikan kepada")}>
                        {t.assignee ? <span className={tk.who}><Avatar name={t.assignee} size="sm" /><span>{t.assignee}</span></span> : <span className={tk.muted}>—</span>}
                      </td>
                    )}
                    {opts.who && <td data-label={L("Position", "Jawatan")} className={tk.cap}>{positionOf(t.assigned_to) || <span className={tk.muted}>—</span>}</td>}
                    <td data-label={L("Priority", "Keutamaan")}><span className={`${PRIORITY_CHIP[t.priority] ?? chipNeutral} ${tk.cap}`}>{priorityL(t.priority)}</span></td>
                    <td data-label={L("Deadline", "Tarikh akhir")} className={tk.nowrap}>
                      {t.deadline
                        ? overdue
                          ? <span className={tk.danger}>{L(`Overdue — was due ${dmy(t.deadline)}`, `Tertunggak — sepatutnya ${dmy(t.deadline)}`)}</span>
                          : dmy(t.deadline)
                        : <span className={tk.muted}>—</span>}
                    </td>
                    <td data-label={L("Status", "Status")}>{statusSelect(t)}</td>
                    <td data-label={L("Progress", "Kemajuan")}>{progressBar(t)}</td>
                    {canDelete && <td className={tk.delCell}>{deleteBtn(t)}</td>}
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
                  {t.deadline && <span className={isOverdue(t) ? chipDanger : chipNeutral}>{isOverdue(t) ? L(`was due ${dmy(t.deadline)}`, `sepatutnya ${dmy(t.deadline)}`) : dmy(t.deadline)}</span>}
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
  const { openTasks, overdueCount, pendingCount, doneCount } = taskFigures(tasks, todayISO);
  const unackedCount = tasks.filter(unacked).length;
  const pctOf = (n: number) => (tasks.length > 0 ? Math.round((n / tasks.length) * 100) : 0);

  const myTasks = tasks.filter(isMine);
  const myActive = myTasks.filter((t) => t.status !== "completed");
  const attention = openTasks.filter((t) => isOverdue(t) || unacked(t) || t.priority === "urgent")
    .filter((t) => canManage || isMine(t))
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  const closed = tasks.filter((t) => t.status === "completed");
  const archNeedle = archQ.trim().toLowerCase();
  /* the team's tallies, from the rows already loaded (managers' board) */
  const assignees = (() => {
    const m = new Map<number, { id: number; name: string; role: string; open: number; pending: number; overdue: number; closed: number; total: number }>();
    for (const t of tasks) {
      if (t.assigned_to == null) continue;
      const fromRoster = team.find((u) => u.id === t.assigned_to);
      const cur = m.get(t.assigned_to) ?? { id: t.assigned_to, name: t.assignee ?? fromRoster?.name ?? `#${t.assigned_to}`, role: fromRoster?.position || (fromRoster?.role ?? "").replace(/_/g, " "), open: 0, pending: 0, overdue: 0, closed: 0, total: 0 };
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

  return (
    <TabPage>
      {deleteConfirmNode}
      {taskToastNode}
      <LineTabs value={view} onChange={(k) => go(k)} label={L("Tasks", "Tugasan")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["mine", L("My Tasks", "Tugasan Saya")],
        ...(canManage ? [["all", L("All Tasks", "Semua Tugasan")] as const] : []),
        ["calendar", L("Calendar", "Kalendar")],
        ["reports", L("Reports & Archive", "Laporan & Arkib")],
      ] as readonly (readonly [TaskView, string])[]} aside={
        <TabAside>
          <TabAction icon="add" onClick={() => setCreateOpen(true)}>{L("Create Task", "Buat Tugasan")}</TabAction>
        </TabAside>
      } />

      {/* ============================== OVERVIEW ============================== */}
      <TabZone label={L("Overview", "Gambaran")} className={view !== "overview" ? tk.off : ""}>
        <KpiRow label={L("Task summary", "Ringkasan tugasan")}>
          <KpiTile icon="documents" tone="navy" label={L("Total tasks", "Jumlah tugasan")} value={tasks.length} busy={!loaded}
            sub={canManage ? L("on the board", "pada papan") : L("assigned to you", "diberikan kepada anda")}
            onClick={() => { clearFilters(); setStatusF("any"); go(canManage ? "all" : "mine"); }} />
          <KpiTile icon="orders" tone="blue" label={L("Open", "Terbuka")} value={openTasks.length} busy={!loaded}
            sub={L(`${pctOf(openTasks.length)}% of total · open + pending`, `${pctOf(openTasks.length)}% daripada jumlah · terbuka + menunggu`)}
            onClick={() => { setStatusF("active"); go(canManage ? "all" : "mine"); }} />
          <KpiTile icon="time" tone="red" label={L("Overdue", "Lewat")} value={overdueCount} busy={!loaded}
            sub={L(`${pctOf(overdueCount)}% of total`, `${pctOf(overdueCount)}% daripada jumlah`)}
            onClick={() => { setStatusF("active"); setSortK("deadline"); go(canManage ? "all" : "mine"); }} />
          <KpiTile icon="pending" tone="gold" label={L("Pending", "Menunggu")} value={pendingCount} busy={!loaded}
            sub={L(`${pctOf(pendingCount)}% of total`, `${pctOf(pendingCount)}% daripada jumlah`)}
            onClick={() => { setStatusF("in_progress"); go(canManage ? "all" : "mine"); }} />
          <KpiTile icon="success" tone="green" label={L("Closed", "Selesai")} value={doneCount} busy={!loaded}
            sub={L(`${pctOf(doneCount)}% of total`, `${pctOf(doneCount)}% daripada jumlah`)}
            onClick={() => go("reports", "task-archive")} />
        </KpiRow>

        {/* v1.209.0 - your own work as a board, three columns (the three
            statuses there are), the newest three of each */}
        <section className={card} aria-label={L("My tasks board", "Papan tugasan saya")}>
          {head("users", tk.goldWell, L("My Tasks", "Tugasan Saya"), L("Tasks assigned to you, by status.", "Tugasan yang diberikan kepada anda, mengikut status."),
            <button type="button" className={btnSm} onClick={() => { clearFilters(); setMineMode("board"); go("mine"); }}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>)}
          {!loaded ? <SkelRows rows={3} /> : myTasks.length === 0 ? caughtUp : renderBoard(myTasks, 3)}
        </section>

        <div className={tk.split}>
          <section className={card} aria-label={L("Tasks requiring attention", "Tugasan perlu perhatian")}>
            {head("warning", tk.redWell, L("Tasks Requiring Attention", "Tugasan Perlu Perhatian"), L("Overdue, not yet acknowledged, or urgent.", "Lewat, belum diakui, atau segera."))}
            {!loaded ? <SkelRows rows={3} /> : attention.length === 0 ? (
              <p className={tk.empty}><AppIcon name="success" />{L("Nothing needs attention — no overdue, unacknowledged or urgent task.", "Tiada yang perlu perhatian — tiada tugasan lewat, belum diakui atau segera.")}</p>
            ) : (
              <ul className={tk.attn}>
                {attention.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => void openChecklist(t.id)}>
                      <span className={tk.attnText}>
                        <strong>{t.title}</strong>
                        <span className={tk.muted}>{t.assignee ?? ""}{t.deadline ? ` · ${L("due", "sebelum")} ${dmy(t.deadline)}` : ""}</span>
                      </span>
                      <span className={tk.badges}>
                        {isOverdue(t) && <span className={chipDanger}>{L("Overdue", "Lewat")}</span>}
                        {unacked(t) && <span className={chipWarn}>{L("Not acknowledged", "Belum diakui")}</span>}
                        {t.priority === "urgent" && <span className={chipDanger}>{priorityL("urgent")}</span>}
                      </span>
                      <AppIcon name="next" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={card} aria-label={L("My active tasks", "Tugasan aktif saya")}>
            {head("orders", tk.goldWell, L("My Active Tasks", "Tugasan Aktif Saya"), L("Tasks assigned to you that are still open or pending.", "Tugasan yang diberikan kepada anda yang masih terbuka atau menunggu."),
              <button type="button" className={btnSm} onClick={() => { clearFilters(); go("mine"); }}>{L("View all", "Lihat semua")}</button>)}
            {!loaded ? <SkelRows rows={3} /> : myActive.length === 0 ? caughtUp : (
              <ul className={tk.mini}>
                {myActive.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <span className={tk.attnText}>
                      <strong className={isOverdue(t) ? tk.danger : ""}>{t.title}</strong>
                      <span className={tk.muted}>{priorityL(t.priority)}{t.deadline ? ` · ${isOverdue(t) ? L("was due", "sepatutnya") : L("due", "sebelum")} ${dmy(t.deadline)}` : ""}</span>
                    </span>
                    {progressBar(t)}
                    {statusSelect(t)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={tk.split}>
          <section className={card} aria-label={L("Task progress", "Kemajuan tugasan")}>
            {head("chart", tk.goldWell, canManage ? L("Task Progress — Company Wide", "Kemajuan Tugasan — Seluruh Syarikat") : L("My Task Progress", "Kemajuan Tugasan Saya"),
              canManage ? L("Every task on the board, by status.", "Setiap tugasan pada papan, mengikut status.") : L("Your tasks, by status.", "Tugasan anda, mengikut status."))}
            {!loaded ? <SkelRows rows={2} /> : (
              <div className={tk.donutRow}>
                <Donut size={140} hideLegend centerLabel={String(tasks.length)} centerSub={L("total tasks", "jumlah tugasan")} slices={[
                  { label: L("Open", "Terbuka"), value: openTasks.length - pendingCount, color: "var(--info)" },
                  { label: L("Pending", "Menunggu"), value: pendingCount, color: "var(--warning)" },
                  { label: L("Closed", "Selesai"), value: doneCount, color: "var(--success)" },
                ]} />
                <ul className={tk.legend}>
                  {([
                    [L("Open", "Terbuka"), openTasks.length - pendingCount, "var(--info)"],
                    [L("Pending", "Menunggu"), pendingCount, "var(--warning)"],
                    [L("Closed", "Selesai"), doneCount, "var(--success)"],
                    [L("Overdue", "Lewat"), overdueCount, "var(--danger)"],
                    [L("Not acknowledged", "Belum diakui"), unackedCount, "var(--muted-foreground)"],
                  ] as const).map(([label, n, color]) => (
                    <li key={label}><span className={tk.dotFree} style={{ background: color }} aria-hidden /><span>{label}</span><strong>{n}</strong><span className={tk.muted}>{pctOf(n)}%</span></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Recently closed", "Baru ditutup")}>
            {head("success", tk.greenWell, L("Recently Closed Tasks", "Tugasan Baru Ditutup"), L("The latest closed tasks, newest set first.", "Tugasan terkini yang ditutup, yang terbaru dahulu."),
              <button type="button" className={btnSm} onClick={() => go("reports", "task-archive")}>{L("View all", "Lihat semua")}</button>)}
            {!loaded ? <SkelRows rows={3} /> : closed.length === 0 ? <p className={tk.empty}><AppIcon name="orders" />{L("No closed tasks yet.", "Belum ada tugasan ditutup.")}</p> : (
              <ul className={tk.mini}>
                {closed.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <span className={tk.doneIcon}><AppIcon name="success" /></span>
                    <span className={tk.attnText}>
                      <strong>{t.title}</strong>
                      <span className={tk.muted}>{t.assignee ? L(`Closed · ${t.assignee}`, `Ditutup · ${t.assignee}`) : L("Closed", "Ditutup")}{t.deadline ? ` · ${L("due", "sebelum")} ${dmy(t.deadline)}` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {canManage && (
          <section className={card} aria-label={L("Team task summary", "Ringkasan tugasan pasukan")}>
            {head("users", tk.blueWell, L("Team Task Summary", "Ringkasan Tugasan Pasukan"), L("Task statistics by staff. Press a name to see their tasks.", "Statistik tugasan mengikut kakitangan. Tekan nama untuk melihat tugasan mereka."))}
            {!loaded ? <SkelRows rows={4} /> : assignees.length === 0 ? <p className={tk.empty}>{L("No tasks yet.", "Belum ada tugasan.")}</p> : (
              <div className={`erp-table-scroll erp-mt-2 ${tk.tableWrap}`}>
                <table className={tk.plain} aria-label={L("Team task summary", "Ringkasan tugasan pasukan")}>
                  <thead><tr><th>{L("Staff", "Kakitangan")}</th><th>{L("Role", "Peranan")}</th><th className={tk.num}>{L("Open", "Terbuka")}</th><th className={tk.num}>{L("Pending", "Menunggu")}</th><th className={tk.num}>{L("Overdue", "Lewat")}</th><th className={tk.num}>{L("Closed", "Selesai")}</th><th className={tk.num}>{L("Total", "Jumlah")}</th></tr></thead>
                  <tbody>
                    {assignees.map((a) => (
                      <tr key={a.id}>
                        <td><button type="button" className={tk.nameBtn} onClick={() => { setWhoF(a.id); setStatusF("any"); go("all"); }}><Avatar name={a.name} size="sm" /><span>{a.name}</span></button></td>
                        <td className={tk.cap}>{a.role || "—"}</td>
                        <td className={tk.num}>{a.open}</td><td className={tk.num}>{a.pending}</td>
                        <td className={`${tk.num} ${a.overdue > 0 ? tk.danger : ""}`}>{a.overdue}</td>
                        <td className={tk.num}>{a.closed}</td><td className={`${tk.num} ${tk.strong}`}>{a.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </TabZone>

      {/* ============================== MY TASKS ============================== */}
      <TabZone label={canManage ? L("My work", "Kerja saya") : L("My work", "Kerja saya")} className={view !== "mine" ? tk.off : ""}>
      {(() => {
        const modeRow = (
          <div className={tk.modeRow}>
            <div role="group" aria-label={L("View", "Paparan")} className={tk.mode}>
              <button type="button" aria-pressed={mineMode === "list"} onClick={() => setMineMode("list")}><AppIcon name="orders" />{L("List", "Senarai")}</button>
              <button type="button" aria-pressed={mineMode === "board"} onClick={() => setMineMode("board")}><AppIcon name="chart" />{L("Board", "Papan")}</button>
            </div>
          </div>
        );
        const subMine = L("Tasks assigned to you — tick the scope, move the status, acknowledge what was given to you.", "Tugasan yang diberikan kepada anda — tanda skop, ubah status, akui apa yang diberikan kepada anda.");
        return mineMode === "list" ? renderTasks(sift(myTasks, { status: true }), L("My Tasks", "Tugasan Saya"), !loaded, {
          sub: subMine,
          empty: statusF === "active" && !needle && !prioF ? caughtUp : <p className={tk.empty}><AppIcon name="search" />{L("No task matches — clear the search or a filter.", "Tiada tugasan sepadan — kosongkan carian atau penapis.")}</p>,
          tools: <>{modeRow}{toolbar(false)}</>,
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
      </TabZone>

      {/* ============================== ALL TASKS ============================== */}
      {canManage && (
      <TabZone label={L("The work", "Kerja")} className={view !== "all" ? tk.off : ""}>
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
        const subAll = L("Every task on the board — who it is with, how far along, and by when.", "Setiap tugasan pada papan — dengan siapa, sejauh mana, dan bila.");
        return allMode === "list" ? renderTasks(sift(tasks, { status: true, who: true }), L("All Tasks", "Semua Tugasan"), !loaded, {
          who: true,
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
      </TabZone>
      )}

      {/* ============================== CALENDAR ============================== */}
      {/* v1.209.0 - the deadlines of the tasks already loaded, by month. No
          calendar of its own and no event is written: a task appears on the
          day its deadline says, and pressing it opens the task. */}
      <TabZone label={L("Deadlines", "Tarikh akhir")} className={view !== "calendar" ? tk.off : ""}>
        {(() => {
          const scope = canManage ? tasks : myTasks;
          const [y, m] = calMonth.split("-").map(Number) as [number, number];
          const first = new Date(Date.UTC(y, m - 1, 1));
          const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const lead = (first.getUTCDay() + 6) % 7; // Monday first
          const byDay = new Map<string, Task[]>();
          for (const t of scope) if (t.deadline && t.deadline.startsWith(calMonth)) byDay.set(t.deadline.slice(0, 10), [...(byDay.get(t.deadline.slice(0, 10)) ?? []), t]);
          const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setCalMonth(d.toISOString().slice(0, 7)); };
          const monthName = first.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
          const inMonth = scope.filter((t) => t.deadline?.startsWith(calMonth));
          const noDate = scope.filter((t) => !t.deadline && t.status !== "completed").length;
          return (
            <section className={card} aria-label={L("Task deadlines calendar", "Kalendar tarikh akhir tugasan")}>
              {head("date", tk.blueWell, L("Deadlines", "Tarikh akhir"), canManage ? L("Every task on the board, on the day it is due.", "Setiap tugasan pada papan, pada hari ia perlu siap.") : L("Your tasks, on the day each is due.", "Tugasan anda, pada hari setiap satu perlu siap."),
                <span className={tk.calNav}>
                  <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelum")} onClick={() => shift(-1)}><AppIcon name="previous" /></button>
                  <strong className={tk.calMonth}>{monthName}</strong>
                  <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} onClick={() => shift(1)}><AppIcon name="next" /></button>
                  {calMonth !== todayISO.slice(0, 7) && <button type="button" className={btnSm} onClick={() => setCalMonth(todayISO.slice(0, 7))}>{L("Today", "Hari ini")}</button>}
                </span>)}
              {!loaded ? <SkelRows rows={5} /> : (
                <>
                  <p className={tk.sub}>{L(`${inMonth.length} due this month · ${inMonth.filter((t) => t.status !== "completed" && isOverdue(t)).length} overdue · ${noDate} open with no deadline`, `${inMonth.length} perlu siap bulan ini · ${inMonth.filter((t) => t.status !== "completed" && isOverdue(t)).length} lewat · ${noDate} terbuka tanpa tarikh akhir`)}</p>
                  <div className={tk.cal} role="grid" aria-label={monthName}>
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => <span key={d} className={tk.calHead} role="columnheader">{L(d, ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"][i]!)}</span>)}
                    {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className={tk.calBlank} aria-hidden />)}
                    {Array.from({ length: days }, (_, i) => {
                      const iso = `${calMonth}-${String(i + 1).padStart(2, "0")}`;
                      const list = byDay.get(iso) ?? [];
                      return (
                        <div key={iso} className={tk.calDay} role="gridcell" data-today={iso === todayISO ? "" : undefined} aria-label={`${dmy(iso)}${list.length ? `, ${list.length} ${L("due", "perlu siap")}` : ""}`}>
                          <span className={tk.calNum}>{i + 1}</span>
                          {list.slice(0, 3).map((t) => (
                            <button key={t.id} type="button" onClick={() => void openChecklist(t.id)}
                              className={`${tk.calTask} ${t.status === "completed" ? tk.calDone : isOverdue(t) ? tk.calLate : ""}`}
                              title={`${t.title}${t.assignee ? ` · ${t.assignee}` : ""}`}>
                              {t.title}
                            </button>
                          ))}
                          {list.length > 3 && <span className={tk.calMore}>{L(`+${list.length - 3} more`, `+${list.length - 3} lagi`)}</span>}
                        </div>
                      );
                    })}
                    {Array.from({ length: (7 - ((lead + days) % 7)) % 7 }, (_, i) => <span key={`a${i}`} className={tk.calBlank} aria-hidden />)}
                  </div>
                  {/* the same month as a list: big targets on a phone, and the
                      whole title where the grid can only show its start */}
                  {inMonth.length > 0 && (
                    <ul className={tk.agenda} aria-label={L("Due this month", "Perlu siap bulan ini")}>
                      {[...inMonth].sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).map((t) => (
                        <li key={t.id}>
                          <button type="button" onClick={() => void openChecklist(t.id)}>
                            <span className={tk.agendaDate}>{dmy(t.deadline!).slice(0, 5)}</span>
                            <span className={tk.attnText}><strong className={isOverdue(t) ? tk.danger : ""}>{t.title}</strong><span className={tk.muted}>{t.assignee ?? ""}</span></span>
                            <span className={t.status === "completed" ? chipSuccess : isOverdue(t) ? chipDanger : t.status === "in_progress" ? chipWarn : chipInfo}>{isOverdue(t) ? L("Overdue", "Lewat") : statusL(t.status)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={tk.hint}>{L("A task without a deadline is not on the calendar. The days a task is booked for work are on the Roster (Attendance).", "Tugasan tanpa tarikh akhir tiada dalam kalendar. Hari tugasan ditempah untuk kerja ada dalam Roster (Kehadiran).")}</p>
                </>
              )}
            </section>
          );
        })()}
      </TabZone>

      {/* ============================ REPORTS & ARCHIVE ============================ */}
      <TabZone label={L("Reports and archive", "Laporan dan arkib")} className={view !== "reports" ? tk.off : ""}>
        {/* the company-wide card (management roles), as before */}
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
                          <td><span className={tk.who}><Avatar name={a.name} size="sm" /><span>{a.name}</span></span></td>
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
        {renderTasks(tasks.filter((t) => t.status === "completed").filter((t) => !archNeedle || [t.title, t.description ?? "", t.assignee ?? ""].some((x) => x.toLowerCase().includes(archNeedle))), L("Completed tasks", "Tugasan selesai"), !loaded, {
          who: canManage,
          pager: { page: archPage, set: setArchPage },
          /* v1.209.0 - the board read is the newest 200 (100 for your own);
             the archive says so rather than looking complete. The owner chose
             "not now" for a server page past them. */
          sub: <>{L("Closed tasks stay here with their scope checklist — who ticked each item and when. Set a status back to Open or Pending to re-open one.", "Tugasan yang ditutup kekal di sini dengan senarai skopnya — siapa menanda setiap item dan bila. Tetapkan status kembali kepada Terbuka atau Menunggu untuk membukanya semula.")} {L(`Searched among the newest ${canManage ? 200 : 100} tasks on the board.`, `Dicari dalam ${canManage ? 200 : 100} tugasan terbaharu pada papan.`)}</>,
          tools: (
            <div className={tk.toolbar} role="search">
              <label className={tk.search}>
                <AppIcon name="search" />
                <input type="search" value={archQ} aria-label={L("Search the archive", "Cari dalam arkib")}
                  placeholder={L("Search closed tasks…", "Cari tugasan ditutup…")} onChange={(e) => { setArchQ(e.target.value); setArchPage(1); }} />
              </label>
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
            <Sub t={L("Deadline (optional)", "Tarikh akhir (pilihan)")}>
              <input
                type="date"
                className={inputClass}
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
        const canEdit = mine || canManage;
        const creator = t.created_by == null ? null : t.created_by === user.id ? L("You", "Anda") : team.find((u) => u.id === t.created_by)?.name ?? null;
        const doneItems = (items ?? []).filter((it) => it.done === 1 && it.done_by_name);
        const startEdit = () => setEditing({ title: t.title, description: t.description ?? "", priority: t.priority, deadline: t.deadline ?? "", assigned_to: t.assigned_to ?? 0 });
        const saveEdit = async () => {
          if (!editing || !editing.title.trim()) return;
          const patch: Record<string, unknown> = {};
          if (editing.title.trim() !== t.title) patch.title = editing.title.trim();
          if (editing.description !== (t.description ?? "")) patch.description = editing.description;
          if (editing.priority !== t.priority) patch.priority = editing.priority;
          if (editing.deadline !== (t.deadline ?? "")) patch.deadline = editing.deadline;
          if (canManage && editing.assigned_to && editing.assigned_to !== t.assigned_to) patch.assigned_to = editing.assigned_to;
          if (Object.keys(patch).length === 0) { setEditing(null); return; }
          if (await update(t.id, patch)) setEditing(null);
        };
        return (
          <SideDrawer open onClose={closeDetail} wide title={t.title}
            subtitle={<span className={tk.badges}>
              <span className={`${PRIORITY_CHIP[t.priority] ?? chipNeutral} ${tk.cap}`}>{priorityL(t.priority)}</span>
              <span className={t.status === "completed" ? chipSuccess : t.status === "in_progress" ? chipWarn : chipInfo}>{statusL(t.status)}</span>
              {t.deadline && <span className={isOverdue(t) ? chipDanger : chipNeutral}>{isOverdue(t) ? L(`Overdue — was due ${dmy(t.deadline)}`, `Lewat — sepatutnya ${dmy(t.deadline)}`) : L(`Due ${dmy(t.deadline)}`, `Perlu siap ${dmy(t.deadline)}`)}</span>}
            </span>}
            footer={<span className={tk.drawerFoot}>{statusSelect(t)}{ackControl(t)}{deleteBtn(t)}</span>}>
            <div className={tk.detail} data-record={`task:${t.id}`}>
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
                      <Sub t={L("Deadline", "Tarikh akhir")}><input type="date" className={inputClass} value={editing.deadline} onChange={(e) => setEditing({ ...editing, deadline: e.target.value })} /></Sub>
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
                      <div><dt>{L("Assigned to", "Diberikan kepada")}</dt><dd>{t.assignee ? <span className={tk.who}><Avatar name={t.assignee} size="sm" /><span>{t.assignee}{positionOf(t.assigned_to) ? <span className={tk.muted}> · {positionOf(t.assigned_to)}</span> : null}</span></span> : mine ? L("You", "Anda") : "—"}</dd></div>
                      {creator && <div><dt>{L("Created by", "Dibuat oleh")}</dt><dd>{creator}</dd></div>}
                      <div><dt>{L("Priority", "Keutamaan")}</dt><dd className={tk.cap}>{priorityL(t.priority)}</dd></div>
                      <div><dt>{L("Deadline", "Tarikh akhir")}</dt><dd>{t.deadline ? dmy(t.deadline) : L("No deadline", "Tiada tarikh akhir")}</dd></div>
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
              <section className={tk.detailSec} aria-label={L("Activity", "Aktiviti")}>
                <p className={tk.title}>{L("Activity", "Aktiviti")}</p>
                {!items ? <SkelRows rows={2} /> : doneItems.length === 0 && !(isAssigned(t) && t.acknowledged) ? (
                  <p className={tk.muted}>{L("Nothing ticked yet.", "Belum ada yang ditanda.")}</p>
                ) : (
                  <ul className={tk.activity}>
                    {isAssigned(t) && t.acknowledged ? <li><AppIcon name="verify" />{L("The assignee acknowledged this task.", "Penerima telah mengakui tugasan ini.")}</li> : null}
                    {doneItems.map((it) => <li key={it.id}><AppIcon name="success" /><span><strong>{it.done_by_name}</strong> {L("ticked", "menanda")} “{it.title}”{it.done_at ? ` · ${dmy(it.done_at.slice(0, 10))}` : ""}</span></li>)}
                  </ul>
                )}
                <p className={tk.hint}>{L("Status changes and acknowledgements are recorded by the system and notified as they happen; a full timeline of them is not shown here yet.", "Perubahan status dan pengakuan direkodkan oleh sistem dan dimaklumkan semasa berlaku; garis masa penuhnya belum dipaparkan di sini.")}</p>
              </section>
            </div>
          </SideDrawer>
        );
      })()}
    </TabPage>
  );
}
