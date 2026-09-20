"use client";

/* v1.8.0 — 📆 Schedule & Roster (the reference design's flagship screen, in
   brand colours). Week time-grid of live sessions with conflict flags, a
   detail popover, stat chips, an unassigned-requests rail, "available today",
   and click-to-assign (reuses POST /staff/live-sessions). Managers see the
   whole floor; hosts see their own week read-only. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { makeApi } from "@/lib/api";
import { leaveOverlaps, timeWindow, isPartialLeave, type LeaveCoverage } from "@/lib/leave-coverage";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { btnClass, btnSm, btnSmInverse, card, chipNeutral, chipSuccess, chipWarn, fieldLabel, iconBtnInverse, inputClass, inputClassSm, modalCard } from "@/lib/ui-styles";
import { dmy, fmtRM } from "@/lib/format";
import { bySeniority } from "@/lib/staff-order";
import { getLang } from "@/lib/i18n";
import { shareRosterPdf } from "@/lib/roster-pdf";
import { MiniCalendar } from "@/components/portal/mini-calendar";
import { Skel, SkelRows } from "@/components/ui/skeleton";
// v1.66.0 Track R — the board is live, and it now carries two kinds of block.
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";

const api = makeApi("/staff");

interface RosterSession {
  id: number; session_date: string; start_time: string; end_time: string | null;
  platform: string; status: string; client: string | null; notes: string | null;
  host_user_id: number; host_name: string; photo_key: string | null;
}
interface RosterTaskBlock {
  id: number; task_id: number; user_id: number; user_name: string;
  block_date: string; start_time: string; end_time: string | null;
  title: string; priority: string; status: string; deadline: string | null;
  done_at?: string | null;
}
/**
 * THE STICKY NOTE — v1.142.0.
 *
 * The CEO, 09-09-2026, on the week grid: *"for the sticky note, can make it
 * nearby to the Task/Live Session. make it more live sticky note"*. He pressed
 * a Wednesday session on Nur Nasuha's row and the card opened at the TOP of
 * the board, three rows away, over other people's work. It was pinned to
 * `left-1/2 top-14` - the middle of the grid - so it told you nothing about
 * which chip it belonged to.
 *
 * A note now opens ON the chip that was pressed. The chip is measured against
 * the board it sits in, so the note follows it through the horizontal scroll
 * and through any row: below the chip normally, ABOVE it when the bottom of
 * the board is too close, and clamped so it can never leave the board on
 * either side. A tail points back at the chip, and the chip itself takes a
 * gold ring, so the note and its work are one object rather than two.
 *
 * The width is the card's own (w-72); the height estimate below is used for
 * ONE decision only - whether there is room underneath. When the note flips it
 * is anchored by its BOTTOM to the chip's top, so the tail meets the chip
 * exactly however tall the card turns out to be.
 */
interface NoteAt { left: number; top?: number; bottom?: number; arrow: number; flip: boolean }

const NOTE_W = 288;          /* w-72 */
const NOTE_H_GUESS = 190;    /* the tallest it gets: notes plus three actions */

function noteFrom(el: HTMLElement, wrap: HTMLElement | null): NoteAt | null {
  if (!wrap) return null;
  const c = el.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  if (w.width <= 0) return null;
  const cx = c.left - w.left + c.width / 2;
  const chipTop = c.top - w.top;
  const chipBottom = c.bottom - w.top;
  const left = Math.max(8, Math.min(cx - NOTE_W / 2, Math.max(8, w.width - NOTE_W - 8)));
  const flip = chipBottom + NOTE_H_GUESS + 10 > w.height && chipTop - 10 > NOTE_H_GUESS / 2;
  return {
    left,
    top: flip ? undefined : chipBottom + 10,
    bottom: flip ? Math.max(4, w.height - chipTop + 10) : undefined,
    arrow: Math.max(16, Math.min(cx - left, NOTE_W - 16)),
    flip,
  };
}

/** The shell: placed, tailed, and out of the way of nothing else. Module
    scope, so React keeps one instance instead of rebuilding it every render. */
function StickyNote({ at, children }: { at: NoteAt; children: ReactNode }) {
  /* v1.159.9 - the board clips (overflow-hidden), and the guess above is a
     guess: a Sales-duty note with a focus line and four actions is taller
     than it, and on a five-row board it opened with its head cut off. So
     after the note is drawn it measures ITSELF against the board and slides
     just enough to sit inside - the chip keeps its gold ring, and the tail
     is dropped when it would no longer point at the chip. */
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const wrap = el?.offsetParent as HTMLElement | null;
    if (!el || !wrap) return;
    const h = el.offsetHeight;
    const H = wrap.clientHeight;
    let s = 0;
    if (at.top !== undefined && at.top + h + 4 > H) s = Math.max(4 - at.top, H - 4 - (at.top + h));
    if (at.bottom !== undefined && H - at.bottom - h < 4) s = Math.min(at.bottom - 4, 4 - (H - at.bottom - h));
    setShift(Math.round(s));
  }, [at]);
  return (
    <div ref={ref} className="bg-brand absolute z-30 w-72 rounded-xl p-3.5 text-white shadow-xl"
      style={{ left: at.left, top: at.top !== undefined ? at.top + shift : undefined, bottom: at.bottom !== undefined ? at.bottom - shift : undefined }}>
      {shift === 0 && (
        <span aria-hidden="true" className="bg-brand absolute h-3 w-3 rotate-45"
          style={at.flip ? { left: at.arrow - 6, bottom: -6 } : { left: at.arrow - 6, top: -6 }} />
      )}
      {children}
    </div>
  );
}

interface UnscheduledTask {
  id: number; title: string; priority: string; deadline: string | null;
  assigned_to: number; assignee: string;
}
interface UnschedDraft { id: number; title: string; assigned_to: string; priority: string; deadline: string }

/** v1.91.0 — the compact editor under an unscheduled card. Module scope
    (guard #30): it holds an input, and a component declared inside the board
    would drop the caret on every keystroke. */
/* Module-scope components cannot see the board's live `L`; this reads the
   same stored language. */
const Lm = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

function UnschedEdit({ draft, staff, busy, onChange, onSave, onDone, onDelete, onCancel }: {
  draft: UnschedDraft;
  staff: { id: number; name: string }[];
  busy: boolean;
  onChange: (d: UnschedDraft) => void;
  onSave: () => void;
  onDone: () => void;
  /* v1.171.0 - the CEO only (task_delete). Absent for everybody else, so the
     button is not offered where the server would refuse it. */
  onDelete?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-border space-y-1.5 border-t px-2.5 py-2">
      <input className={inputClassSm + " w-full"} value={draft.title} maxLength={200}
        aria-label={Lm("Title", "Tajuk")} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-1.5">
        <select className={inputClassSm} value={draft.assigned_to} aria-label={Lm("Assigned to", "Ditugaskan kepada")}
          onChange={(e) => onChange({ ...draft, assigned_to: e.target.value })}>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name.split(" ").slice(0, 2).join(" ")}</option>)}
        </select>
        <select className={inputClassSm} value={draft.priority} aria-label={Lm("Priority", "Keutamaan")}
          onChange={(e) => onChange({ ...draft, priority: e.target.value })}>
          {(["low", "normal", "high", "urgent"] as const).map((p) => (
            <option key={p} value={p}>{p === "low" ? Lm("Low", "Rendah") : p === "normal" ? Lm("Normal", "Biasa") : p === "high" ? Lm("High", "Tinggi") : Lm("Urgent", "Segera")}</option>
          ))}
        </select>
        <input type="date" className={`${inputClassSm} col-span-2`} value={draft.deadline} aria-label={Lm("Deadline", "Tarikh akhir")}
          onChange={(e) => onChange({ ...draft, deadline: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btnSm + " bg-primary text-primary-foreground border-primary"} disabled={busy} onClick={onSave}>{Lm("Save", "Simpan")}</button>
        <button type="button" className={btnSm} disabled={busy} onClick={onDone}>{Lm("Mark done", "Tanda selesai")}</button>
        {onDelete && (
          <button type="button" className="erp-button erp-button-danger h-8 min-h-8 px-3 text-xs" disabled={busy} onClick={onDelete}>
            {Lm("Delete", "Padam")}
          </button>
        )}
        <button type="button" className="text-muted-foreground ml-auto text-xs underline" onClick={onCancel}>{Lm("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/** v1.131.0 — a span of APPROVED leave. The board's own week (/roster) and the
    dialogs' wider window (/leave/calendar) return the same four fields, so one
    predicate can read both without caring which list a row came from. */
interface LeaveSpan extends LeaveCoverage { user_id: number; name: string }

/** v1.158.0 - a day of sales duty. A plan, never a claim: `evidence` is how
    many rows the person put on the Sales Performance register that day, read
    by the server, so the chip can say whether the planned day was worked. */
interface SalesShift {
  id: number; user_id: number; user_name: string; shift_date: string;
  start_time: string; end_time: string; target_cents: number | null; focus: string | null;
  evidence: number;
}
/* The roles that may hold sales duty - the same two the Sales Performance
   register measures (worker MEASURED_ROLES; tests/roster-week.mjs compares). */
const SALES_DUTY_ROLES: readonly string[] = ["sales_marketing", "live_host"];

/** v1.171.0 - a company event in the week. The CEO, 20-09-2026: *"it is
    should be able to sync with the calendar and the event should be appear
    on it also! which is there is any event assigned to the staff, it will
    show there"*. `attendees` EMPTY MEANS EVERYONE - migration 0122's rule -
    so those are drawn against the DAY, not repeated down every row. */
interface RosterEvent {
  id: number; title: string; category: string; event_date: string;
  start_time: string | null; end_time: string | null; location: string | null;
  attendees: number[];
}

interface RosterData {
  week_start: string; days: string[]; manager: boolean;
  sessions: RosterSession[];
  on_leave: LeaveSpan[];
  conflicts: { kind: string; session_ids: number[]; task_block_ids?: number[];
               host_user_id: number; date: string; soft?: boolean }[];
  /* v1.66.0 — beside the sessions, never merged into them. A task block says
     WHEN THE WORK HAPPENS; the task still owns what it is and who it is for. */
  task_blocks?: RosterTaskBlock[];
  unscheduled?: UnscheduledTask[];
  sales_shifts?: SalesShift[];
  /* v1.158.4 - each person's own rest days, from their working-hours pattern. */
  rest_days?: { user_id: number; date: string; pattern: string }[];
  /* v1.171.0 - the week's company events, with who they were assigned to. */
  events?: RosterEvent[];
  requests: { id: number; name: string; company: string | null; category: string | null; created_at: string }[];
  available_today: { id: number; name: string; role: string; photo_key: string | null }[];
}

const DAY_START = 8;   // 08:00
const DAY_END = 23;    // 23:00
const HOUR_PX = 44;

function mins(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
/* v1.22.8 (CEO: "timeline for the 8 to 10pm was not flow correctly!"): a
   session that ends past midnight (20:30–00:00) has end < start, so its
   duration went NEGATIVE — the timeline drew a flat 22px sliver and the
   grid/PDF called it 30 min. An overnight end now counts as next-day. */
function spanMins(start: string, end: string): number {
  let d = mins(end) - mins(start);
  if (d <= 0) d += 24 * 60;
  return d;
}
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
}
function shiftWeek(weekStart: string, weeks: number): string {
  return new Date(Date.parse(weekStart + "T00:00:00Z") + weeks * 7 * 86400_000).toISOString().slice(0, 10);
}
const DAY_LABEL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABEL_MS = ["ISN", "SEL", "RAB", "KHA", "JUM", "SAB", "AHD"];
function toHHMM(minsTotal: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 45, minsTotal));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/* v1.22.6 (CEO: "I want to have an option for CEO, COO and CCO to amend or
   to update the roster / schedule if necessary or any typo to change"):
   canEdit gates the Edit action — the same assignment dialog reopens
   prefilled, in EDIT mode (no repeat/plan tooling), and Save changes
   PATCHes the one session. canManage alone (hr_admin) still schedules,
   drags, completes and cancels exactly as before. */
export function RosterBoard({ canManage, canEdit = false, canDeleteTask = false, onOpenRegister }: {
  canManage: boolean;
  canEdit?: boolean;
  /* v1.171.0 (CEO, 20-09-2026: "on the attendance, the Task should be able
     to delete!") - mirrors task_delete in worker/src/permissions.ts: the CEO
     and super_admin. Unscheduling a block only takes the work off the day;
     this removes the task itself, which the server allows nobody else. */
  canDeleteTask?: boolean;
  /* v1.159.9 (CEO: "check the sales all link to all the tabs") - a Sales-duty
     note names the register three times and offered no way to it. The page
     passes this only when the account has the Sales Performance tab; it
     opens the register on that person and that day. */
  onOpenRegister?: (staffId: number, day: string) => void;
}) {
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.171.0 - deleting a task is the one thing on this board that cannot be
     undone, so it asks first (the branded dialog, not window.confirm). */
  const { confirm, node: confirmNode } = useConfirm();
  /* v1.23.2 (CEO: "Why some doesn't change to BM?"): the board's READ
     surfaces — title, chips, week bar, agenda — follow the language toggle.
     getLang() re-reads on every render; the toggle re-renders the portal
     tree, so the switch is instant. Manager tooling (the assignment modal,
     detail-card actions) stays EN by design — see lib/i18n.ts. */
  const lang = getLang();
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  /* BM completion — the write surfaces (modals, toasts, confirm bar) follow
     the toggle too. API statuses stay EN in state/payloads; they map to BM
     at the display point only. */
  const statusLabel = (st: string) =>
    lang === "ms" ? (({ scheduled: "dijadualkan", completed: "selesai", cancelled: "dibatalkan" } as Record<string, string>)[st] ?? st) : st;
  const DAYS = lang === "ms" ? DAY_LABEL_MS : DAY_LABEL;
  const [data, setData] = useState<RosterData | null>(null);
  const [week, setWeek] = useState<string>("");           // "" = server default (this week)
  const [openSession, setOpenSession] = useState<number | null>(null);
  /* v1.142.0 - where the sticky note sits, measured off the chip that opened
     it. Null means nothing is open in the week grid; the mobile agenda and the
     timeline keep their own placement. */
  const [noteAt, setNoteAt] = useState<NoteAt | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [staff, setStaff] = useState<{ id: number; name: string; role?: string; position?: string | null; employment_status?: string | null }[]>([]);
  const [draft, setDraft] = useState({ session_date: "", start_time: "19:00", end_time: "21:00", platform: "tiktok", client_name: "", host_user_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  /* v1.21.0 (CEO: "the data of leave applied date should be shown on the
     pill on leave"): the chip opens who is away and exactly when. */
  const [leaveOpen, setLeaveOpen] = useState(false);

  /* v1.131.0 — an approved leave day is closed, and the form has to say so
     BEFORE the press rather than after it.

     Two things worth being exact about.

     FIRST, this is help, not the rule. The rule lives in the worker, on all
     five doors that choose a day for a person (see refuseIfOnLeave in
     worker/src/staff.ts): a stale or missing fetch here costs a clearer
     message, never a wrong booking. It has to be that way round — the same
     inserts are reachable from drag-and-drop, the tap-a-day rail, a repeat run
     and "+ Add to plan", and a rule written into one dialog is a rule four
     other gestures do not have.

     SECOND, the board's own leave list is WEEK-scoped: /roster returns the
     week it is drawing. A repeat rule reaches up to 62 days past it, so the
     dialog fetches the span it is actually about to write into and the
     predicate below reads both lists at once.

     A native <input type="date"> cannot grey out individual days — min/max is
     all the browser gives — so "not available" is spelled out instead: the
     clash is named in red under the picker, the run drops those entries and
     says how many, and the press refuses when nothing is left. */
  const [spanLeave, setSpanLeave] = useState<LeaveSpan[]>([]);
  /* The officers' way past it. Approved leave is terminal in this system —
     nobody can un-approve it — so a rule with no way out would leave a day
     unbookable for ever when somebody comes in anyway. Off on every open. */
  const [leaveOverride, setLeaveOverride] = useState(false);
  const onLeaveAt = useCallback((uid: number | string, d: string, start?: string, end?: string | null) => {
    const id = Number(uid);
    if (!id || !d) return false;
    return [...(data?.on_leave ?? []), ...spanLeave]
      .some((l) => l.user_id === id && leaveOverlaps(l, d, timeWindow(start, end)));
  }, [data, spanLeave]);

  const [notReady, setNotReady] = useState(false);
  /* v1.9.0 drag-and-drop: drag a block to another day/slot; a confirm bar
     appears before anything is saved. */
  const [drag, setDrag] = useState<{ id: number; grabOffsetY: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ s: RosterSession; date: string; start: string; end: string | null } | null>(null);

  const [failed, setFailed] = useState(false);
  const load = useCallback(async (w: string) => {
    setFailed(false);
    const r = await api<RosterData & { error?: { message?: string } }>(`/roster${w ? `?week=${w}` : ""}`);
    if (r.ok && r.data?.days) setData(r.data);
    else if (/route not found/i.test(r.data?.error?.message ?? "") || r.data?.error?.message?.includes("0056")) setNotReady(true);
    else setFailed(true);
  }, []);
  useEffect(() => { void load(week); }, [week, load]);
  /* v1.66.0: the board is one of the busiest shared screens in the portal —
     a manager plans while a host marks a session done. Four topics, because
     the week is now made of four things. */
  const reload = useCallback(() => { void load(week); }, [load, week]);
  useLiveRefresh(["live-sessions", "task-blocks", "tasks", "leave"], reload);
  useEffect(() => {
    if (!canManage) return;
    /* v1.91.0 (CEO: "ascending by position which is starting by CEO, COO,
       CCO, hr_admin, sales marketing, designer and live host") — the grid
       rows, the pickers and the rail all read this list, and it arrives
       alphabetical. Sorted once, here, by the ONE company order every
       payroll surface already uses (lib/staff-order.ts). */
    void api<{ staff: { id: number; name: string; role?: string; position?: string | null; employment_status?: string | null }[] }>(`/staff-list`)
      .then((r) => { if (r.ok && r.data?.staff) setStaff([...r.data.staff].sort(bySeniority)); });
  }, [canManage]);

  const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  /* v1.157.0 - PUBLIC HOLIDAYS ON THE BOARD. CEO, 13-09-2026, with Hari
     Malaysia (Wed 16-09) drawn as an ordinary working day: "Public Holiday
     should appear at here also since it is no working day". The holidays
     table has been the company calendar since v1.4.81 (the Events tab paints
     it, payroll counts it); the roster simply never asked. The week's year -
     and the next one when the week straddles New Year - is fetched once and
     kept, so paging through weeks costs nothing. A holiday is NOT a refusal:
     a host may be booked on one (s.60D pays it at two days' wages), so the
     column is named and tinted, never locked. */
  const [holidays, setHolidays] = useState<Record<string, { name: string; kind: string }>>({});
  const holidayYears = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const years = new Set(data.days.map((d) => d.slice(0, 4)));
    for (const y of years) {
      if (holidayYears.current.has(y)) continue;
      holidayYears.current.add(y);
      void api<{ holidays: { holiday_date: string; name: string; kind: string }[] }>(`/holidays?year=${y}`).then((r) => {
        if (!r.ok || !r.data) { holidayYears.current.delete(y); return; }
        setHolidays((h) => {
          const next = { ...h };
          for (const x of r.data!.holidays) next[x.holiday_date] = { name: x.name, kind: x.kind };
          return next;
        });
      });
    }
  }, [data]);
  const holidayAt = (d: string) => holidays[d];
  const holidayLabel = (h: { name: string; kind: string }) =>
    h.kind === "replacement" ? L(`${h.name} (replacement holiday)`, `${h.name} (cuti ganti)`) : L(`${h.name} · public holiday`, `${h.name} · cuti umum`);

  /* v1.66.0 — placing a task on the grid.
     Not HTML5 drag-and-drop: this board is used on a phone as much as a
     laptop, and dragging on a touch screen fights the page scroll. Pick the
     task, then tap the day — the same two-tap gesture the rest of the portal
     uses, and the only one that works with a thumb. */
  const [armed, setArmed] = useState<UnscheduledTask | null>(null);
  const [openBlock, setOpenBlock] = useState<number | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  /* v1.69.0 (CEO: "I want to have an option for me to update the Task").
     The block bar could tick a day or throw the day away, and nothing in
     between — a wrong deadline or a typo meant deleting the task and
     rebuilding it, losing its scope and its history. One dialog edits both
     halves, because from the board they are one thing: the work, and when
     it happens. */
  const [editBlock, setEditBlock] = useState<RosterTaskBlock | null>(null);
  const [eDraft, setEDraft] = useState({
    title: "", priority: "normal", deadline: "", status: "open", assigned_to: "",
    block_date: "", start_time: "", end_time: "", whole_run: false,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const openEditBlock = (b: RosterTaskBlock) => {
    setEDraft({
      title: b.title, priority: b.priority || "normal",
      deadline: b.deadline ?? "", status: b.status || "open",
      assigned_to: String(b.user_id),
      block_date: b.block_date, start_time: b.start_time, end_time: b.end_time ?? "",
      whole_run: false,
    });
    setEditBlock(b);
    setOpenBlock(null);
  };
  /* v1.91.0 — the unscheduled card's editor. One PATCH, the Tasks tab's. */
  const [editTask, setEditTask] = useState<UnschedDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const saveUnsched = async (status?: "completed") => {
    if (!editTask) return;
    if (!editTask.title.trim()) {
      showToast(L("Not saved", "Tidak disimpan"), L("The task needs a title", "Tugasan perlukan tajuk"), "notice");
      return;
    }
    setEditBusy(true);
    const r = await api<{ ok?: boolean; error?: { message?: string } }>(`/tasks/${editTask.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: editTask.title.trim(),
        assigned_to: Number(editTask.assigned_to) || undefined,
        priority: editTask.priority,
        deadline: editTask.deadline,
        ...(status ? { status } : {}),
      }),
    });
    setEditBusy(false);
    if (!r.ok) {
      showToast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
      return;
    }
    showToast(status ? L("Task completed", "Tugasan selesai") : L("Task updated", "Tugasan dikemas kini"), editTask.title.trim());
    setEditTask(null);
    reload();
  };
  const [taskOpen, setTaskOpen] = useState(false);
  const [tDraft, setTDraft] = useState({
    title: "", assigned_to: "", priority: "normal", deadline: "",
    block_date: "", start_time: "10:00", end_time: "12:00", items: "",
  });
  /* v1.67.0 — the same repeat vocabulary the live-session dialog has used
     since v1.22.1. A standing duty is the normal case for a task, not the
     exception: "watch the floor, every weekday, until Friday". */
  const [tRepeat, setTRepeat] = useState<"once" | "daily" | "days">("once");
  const [tUntil, setTUntil] = useState("");
  const [tDays, setTDays] = useState<number[]>([]);
  /* The dates the rule actually lands on. Capped at 62, like the live
     planner: a rule that expands to a year is a mistake made quickly. */
  const tDates = (): string[] => {
    if (!tDraft.block_date) return [];
    if (tRepeat === "once") return [tDraft.block_date];
    if (!tUntil || tUntil < tDraft.block_date) return [];
    if (tRepeat === "days" && tDays.length === 0) return [];
    const out: string[] = [];
    const end = new Date(`${tUntil}T00:00:00Z`).getTime();
    for (let t = new Date(`${tDraft.block_date}T00:00:00Z`).getTime(); t <= end && out.length < 62; t += 86400000) {
      const dt = new Date(t);
      if (tRepeat === "daily" || tDays.includes(dt.getUTCDay())) out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  };

  /* Marking a day done. The count comes back from the server so the toast
     can say "4 of 5 days" rather than leaving somebody to count chips. */
  const setBlockDone = useCallback(async (b: RosterTaskBlock, done: boolean) => {
    const r = await api<{ done: number; total: number; error?: { message?: string } }>(
      `/task-blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
    if (!r.ok) {
      showToast(L("No change", "Tiada perubahan"),
        r.data?.error?.message ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
      return;
    }
    const n = r.data?.done ?? 0, tot = r.data?.total ?? 0;
    showToast(done ? L("Day done", "Hari selesai") : L("Reopened", "Dibuka semula"),
      tot > 1
        ? L(`${b.title} — ${n} of ${tot} days done.`, `${b.title} — ${n} daripada ${tot} hari selesai.`)
        : b.title);
    setOpenBlock(null);
    void load(week);
  }, [load, week, showToast]);
  const [savingTask, setSavingTask] = useState(false);

  /* v1.158.0 - SALES DUTY. The same shape as the task dialog - one person,
     a day, a repeat rule, hours - because the CEO plans the two the same way
     ("based on the day/date that I pick and assigned"). Two things of its
     own: a target in ringgit, and a focus line. No priority, no deliverables:
     what was done on the day is read from the Sales Performance register,
     not ticked off here. */
  const [salesOpen, setSalesOpen] = useState(false);
  const [sDraft, setSDraft] = useState({ user_id: "", shift_date: todayS, start_time: "10:00", end_time: "18:00", target: "", focus: "" });
  const [sRepeat, setSRepeat] = useState<"once" | "daily" | "days">("once");
  const [sUntil, setSUntil] = useState("");
  const [sDays, setSDays] = useState<number[]>([]);
  const [savingSales, setSavingSales] = useState(false);
  const [openShift, setOpenShift] = useState<number | null>(null);
  const sDates = (): string[] => {
    if (!sDraft.shift_date) return [];
    if (sRepeat === "once") return [sDraft.shift_date];
    if (!sUntil || sUntil < sDraft.shift_date) return [];
    if (sRepeat === "days" && sDays.length === 0) return [];
    const out: string[] = [];
    const end = new Date(`${sUntil}T00:00:00Z`).getTime();
    for (let t = new Date(`${sDraft.shift_date}T00:00:00Z`).getTime(); t <= end && out.length < 62; t += 86400000) {
      const dt = new Date(t);
      if (sRepeat === "daily" || sDays.includes(dt.getUTCDay())) out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  };
  const salesStaff = staff.filter((u) => SALES_DUTY_ROLES.includes(u.role ?? ""));
  /* v1.158.2 (CEO, on the note: "I should have a option to edit!") - the
     same card, in EDIT mode: prefilled, the Repeat box hidden because an
     amendment touches exactly one day (as the live card does), Save changes
     instead of Schedule. */
  const [editingShift, setEditingShift] = useState<number | null>(null);
  const openEditShift = (sh: SalesShift) => {
    setSDraft({
      user_id: String(sh.user_id), shift_date: sh.shift_date, start_time: sh.start_time, end_time: sh.end_time,
      target: sh.target_cents == null ? "" : String(Math.round(sh.target_cents / 100)), focus: sh.focus ?? "",
    });
    setSRepeat("once"); setSUntil(""); setSDays([]);
    setEditingShift(sh.id);
    setOpenShift(null); setNoteAt(null);
    setSalesOpen(true);
  };
  const removeShift = useCallback(async (sh: SalesShift) => {
    const r = await api<{ error?: { message?: string } }>(`/sales-shifts/${sh.id}`, { method: "DELETE" });
    if (!r.ok) {
      showToast(L("Not removed", "Tidak dibuang"), r.data?.error?.message ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
      return;
    }
    setOpenShift(null); setNoteAt(null);
    showToast(L("Sales duty removed", "Tugas jualan dibuang"), `${sh.user_name.split(" ").slice(0, 2).join(" ")} · ${dmy(sh.shift_date)}`);
    void load(week);
  }, [load, week, showToast]);

  const [placing, setPlacing] = useState(false);
  const placeTask = useCallback(async (t: UnscheduledTask, date: string, userId: number) => {
    setPlacing(true);
    const r = await api<{ id: number }>(`/task-blocks`, {
      method: "POST",
      body: JSON.stringify({ task_id: t.id, user_id: userId, block_date: date,
                             start_time: "10:00", end_time: "12:00" }),
    });
    setPlacing(false);
    if (!r.ok) {
      showToast(L("Not scheduled", "Tidak dijadualkan"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
      return;
    }
    setArmed(null);
    showToast(L("Scheduled", "Dijadualkan"),
          L(`${t.title} — ${dmy(date)} 10:00-12:00. Drag the block to change the time.`,
            `${t.title} — ${dmy(date)} 10:00-12:00. Seret blok untuk menukar masa.`), "success");
    void load(week);
  }, [load, week, showToast]);

  /* v1.171.0 — DELETE THE TASK. The CEO, 20-09-2026: *"on the attendance,
     the Task should be able to delete!"*. The board could only ever
     UNSCHEDULE (take the block off the day and leave the task waiting in
     Unscheduled work), so a task created by mistake could be moved around
     the week forever but never got rid of — from here. The server route has
     existed since v1.4.x and is CEO-only; this is the button it never had.
     It removes the task AND every block of it across every week, which is
     why it names the count and asks first. */
  const deleteTask = useCallback(async (taskId: number, title: string, spread: number) => {
    const ok = await confirm({
      title: L("Delete this task?", "Padam tugasan ini?"),
      message: L(
        `"${title}"${spread > 0 ? ` and ${spread === 1 ? "its block on the board" : `all ${spread} of its blocks on the board`}` : ""} will be removed for everyone. Its comments and checklist go with it. This cannot be undone.`,
        `"${title}"${spread > 0 ? ` dan ${spread === 1 ? "bloknya pada papan" : `kesemua ${spread} bloknya pada papan`}` : ""} akan dibuang untuk semua orang. Komen dan senarai semaknya turut dibuang. Ini tidak boleh dibatalkan.`),
      confirmLabel: L("Delete task", "Padam tugasan"),
      cancelLabel: L("Keep it", "Kekalkan"),
      variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ error?: { message?: string } }>(`/tasks/${taskId}`, { method: "DELETE" });
    if (!r.ok) {
      showToast(L("Not deleted", "Tidak dipadam"),
        r.data?.error?.message ?? L("The server refused it — only the CEO may delete a task", "Pelayan menolaknya — hanya CEO boleh memadam tugasan"), "notice");
      return;
    }
    setOpenBlock(null); setNoteAt(null);
    showToast(L("Task deleted", "Tugasan dipadam"), title);
    void load(week);
  }, [confirm, load, week, showToast]);

  const unscheduleBlock = useCallback(async (b: RosterTaskBlock) => {
    const r = await api(`/task-blocks/${b.id}`, { method: "DELETE" });
    if (!r.ok) {
      showToast(L("Not removed", "Tidak dibuang"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
      return;
    }
    showToast(L("Back to unscheduled", "Kembali ke belum dijadualkan"),
          L(`${b.title} left the grid. The task itself is untouched.`,
            `${b.title} keluar dari grid. Tugasan itu sendiri tidak berubah.`), "success");
    void load(week);
  }, [load, week, showToast]);

  /* v1.22.1 (CEO: "I need to create multiple schedule in 1 day or in 1 week
     or advance date. provide me a better workflow"): the dialog builds a
     PLAN before it posts. Repeat rules (daily / picked weekdays until a
     date) expand one entry into many; "Add to plan" stacks entries — same
     day different slots, different hosts, weeks ahead — and "Schedule all"
     creates them in one go. Every created session still bell-notifies its
     host individually. One-off scheduling is unchanged: fill the form and
     the button reads "Schedule" exactly as before. */
  /* v1.22.3 (CEO showed a staff×day reference: "I want weekly roster
     schedule looks like this!"): the desktop default is now a STAFF GRID —
     one row per person, one column per day, sessions as colour chips, hour
     totals on both axes. The hour timeline (with drag-to-reschedule) stays
     one toggle away. Colours stay brand: navy tint = TikTok, gold tint =
     Shopee, neutral = other; green = completed, amber = conflict. */
  const [view, setView] = useState<"grid" | "timeline">("grid");
  /* v1.142.0 - a note is a position, and a position is only true while the
     chip it was measured from is still where it was. Every path that closes a
     chip clears it here, so no stale note can survive a reload, a week change
     or a switch to the timeline (which places its own popover). */
  useEffect(() => {
    if (openSession === null && openBlock === null) setNoteAt(null);
  }, [openSession, openBlock]);
  useEffect(() => { setNoteAt(null); }, [view, week]);

  type PlanEntry = typeof draft;
  const [repeat, setRepeat] = useState<"once" | "daily" | "days">("once");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [repeatDays, setRepeatDays] = useState<number[]>([]); // JS getUTCDay: 0=Sun
  const [plan, setPlan] = useState<PlanEntry[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);

  /* v1.29.5 (CEO: "For host I need to have a multiple host pick if it is
     require"): one slot, several hosts. A session row in the database has
     exactly ONE host — that is what makes the grid, the hour totals, leave
     clashes and per-host notifications work — so picking N hosts creates N
     sessions for the same slot rather than inventing a shared one. The
     primary picker stays the plain <select> it always was (edit mode and
     every existing caller are untouched); these are the EXTRA hosts, and
     they only exist while creating. */
  const [extraHosts, setExtraHosts] = useState<string[]>([]);
  /** Primary + extras, de-duplicated, blanks dropped. */
  const hostIds = (): string[] => {
    const out: string[] = [];
    for (const h of [draft.host_user_id, ...extraHosts]) if (h && !out.includes(h)) out.push(h);
    return out;
  };
  const hostShort = (id: string) => (staff.find((u) => String(u.id) === String(id))?.name ?? "").split(" ").slice(0, 2).join(" ");

  const openAssign = (prefill?: Partial<typeof draft>) => {
    setDraft({ session_date: todayS, start_time: "19:00", end_time: "21:00", platform: "tiktok", client_name: "", host_user_id: "", notes: "", ...prefill });
    setRepeat("once"); setRepeatUntil(""); setRepeatDays([]); setPlan([]);
    setExtraHosts([]);
    /* v1.131.0: the override is per-dialog, never sticky. It is a decision
       about one booking, and a checkbox that stayed on would turn the rule
       off for the rest of the afternoon without saying so. */
    setLeaveOverride(false);
    setEditingId(null);
    setAssignOpen(true);
  };

  /* v1.29.1 (CEO: "when I click mark complete, there is no popup
     notification, I want to use the same popup notification as the existing
     globally!"): Mark completed / Cancel session were six copy-pasted inline
     handlers that fired the PATCH and threw the result away —
     `await api(...); setOpenSession(null); void load(week);`. Two faults in
     that. The action confirmed nothing, so a manager closing off a live had
     no signal it landed; and a FAILED PATCH (offline, CSRF, permission)
     looked identical to a successful one — the card closed, the board
     reloaded, and the session silently stayed "scheduled".
     One handler now serves all six buttons and reports through the same
     useSaveToast that Save, Reschedule and the PDF share already use, so the
     whole portal confirms itself identically. The board only reloads when
     the write actually succeeded. */
  const setSessionStatus = useCallback(
    async (s: RosterSession, status: "completed" | "cancelled") => {
      const r = await api<{ error?: { message?: string } }>(`/live-sessions/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setOpenSession(null);
      const who = s.client ?? L("Live session", "Sesi LIVE");
      const when = `${dmy(s.session_date)} ${s.start_time}`;
      if (!r.ok) {
        showToast(
          L("No change", "Tiada perubahan"),
          r.data?.error?.message ??
            (status === "completed"
              ? L("Could not mark that session completed — it is still scheduled", "Sesi itu tidak dapat ditanda selesai — ia masih dijadualkan")
              : L("Could not cancel that session — it is still scheduled", "Sesi itu tidak dapat dibatalkan — ia masih dijadualkan")),
          "notice",
        );
        return;
      }
      showToast(
        status === "completed" ? L("Session completed", "Sesi selesai") : L("Session cancelled", "Sesi dibatalkan"),
        `${who} · ${when}`,
      );
      void load(week);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- L is derived from lang
    [load, week, showToast, lang],
  );

  /* v1.22.6 — amend/typo-fix: the dialog opens prefilled from the session. */
  const openEdit = (s: RosterSession) => {
    /* v1.139.0 - a "Book anyway" ticked in the assign dialog and then
       cancelled used to survive into this one, so moving an existing session
       onto a leave day carried leave_override: true without anybody
       deciding it again. */
    setLeaveOverride(false);
    setDraft({
      session_date: s.session_date, start_time: s.start_time, end_time: s.end_time ?? "",
      platform: s.platform, client_name: s.client ?? "", host_user_id: String(s.host_user_id), notes: s.notes ?? "",
    });
    setRepeat("once"); setRepeatUntil(""); setRepeatDays([]); setPlan([]);
    /* an amendment touches exactly ONE session, so multi-host has no meaning
       here — clear it so a stale pick cannot leak into the next create. */
    setExtraHosts([]);
    setEditingId(s.id);
    setOpenSession(null);
    setAssignOpen(true);
  };

  const saveEdit = async () => {
    if (editingId == null) return;
    if (!draft.session_date || !draft.start_time || !draft.host_user_id) {
      showToast(L("No change", "Tiada perubahan"), L("Date, start time and host are required", "Tarikh, masa mula dan hos diperlukan"), "notice");
      return;
    }
    setSaving(true);
    const r = await api<{ error?: { message?: string }; applied?: string[] }>(`/live-sessions/${editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        session_date: draft.session_date, start_time: draft.start_time,
        end_time: draft.end_time || null, platform: draft.platform,
        client_name: draft.client_name, notes: draft.notes,
        host_user_id: Number(draft.host_user_id),
        ...(leaveOverride ? { leave_override: true } : {}),
      }),
    });
    setSaving(false);
    if (!r.ok) { showToast(L("No change", "Tiada perubahan"), r.data?.error?.message ?? L("Could not update the session", "Sesi tidak dapat dikemas kini"), "notice"); return; }
    /* v1.22.7 (CEO: "I have done edit, but it doesnt updated!!!"): his live
       worker was an OLDER build — it applied date/time/host and silently
       ignored client/platform/notes, then said ok. The new worker echoes the
       applied columns; no echo = old worker, so say so instead of lying. */
    if (!Array.isArray(r.data?.applied) || !r.data.applied.includes("client_name")) {
      showToast(L("Only the schedule saved", "Hanya jadual disimpan"), L("The API worker is an older build — client, platform and notes were ignored. Run DEPLOY.bat IN FULL (step 3 deploys the worker), then edit again.", "Worker API ialah binaan lama — klien, platform dan catatan diabaikan. Jalankan DEPLOY.bat SEPENUHNYA (langkah 3 melancarkan worker), kemudian sunting semula."), "notice");
    } else {
      showToast(L("Session updated", "Sesi dikemas kini"), `${draft.client_name || L("Live session", "Sesi LIVE")} · ${dmy(draft.session_date)} ${draft.start_time}`);
    }
    setAssignOpen(false); setEditingId(null);
    void load(week);
  };

  /* v1.22.5 (CEO: "when I click pick a day, it doesnt schedule all the day
     that I pick!! … Add to plan become 2? what is the flow actually??!"):
     two flow bugs fixed. (1) Pick-days/Daily with an EMPTY "until" silently
     collapsed to a single date — the until date is now prefilled (+6 days)
     the moment a repeat mode is chosen, and a missing one refuses loudly
     instead of guessing. (2) The primary button no longer morphs into a
     second "Add to plan": SCHEDULE always schedules exactly what is
     configured — the plan if one exists, otherwise the form × repeat rule,
     expanded on the spot. "+ Add to plan" stays the optional stacking tool. */
  const addDays = (iso: string, n: number) =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

  const pickRepeat = (v: "once" | "daily" | "days") => {
    setRepeat(v);
    if (v !== "once" && !repeatUntil && draft.session_date) setRepeatUntil(addDays(draft.session_date, 6));
  };

  /** The dates the current form + repeat rule expand to (capped at 62).
      STRICT: a repeat mode without a usable until/weekday set returns []. */
  const expandDates = (): string[] => {
    if (repeat === "once") return draft.session_date ? [draft.session_date] : [];
    if (!repeatUntil || repeatUntil < draft.session_date) return [];
    if (repeat === "days" && repeatDays.length === 0) return [];
    const out: string[] = [];
    const end = new Date(`${repeatUntil}T00:00:00Z`).getTime();
    for (let t = new Date(`${draft.session_date}T00:00:00Z`).getTime(); t <= end && out.length < 62; t += 86400000) {
      const d = new Date(t);
      if (repeat === "daily" || repeatDays.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  /* v1.131.0 — the leave the OPEN DIALOG needs, which is not the leave the
     board has. Keyed on the two ISO strings rather than the array, so the
     fetch fires when the span actually moves and not on every keystroke in
     the client field. */
  const dialogSpan = (() => {
    const ds = [
      ...(assignOpen ? [...expandDates(), ...plan.map((p) => p.session_date)] : []),
      ...(taskOpen ? tDates() : []),
    ].filter(Boolean).sort();
    if (ds.length === 0) return { from: "", to: "" };
    return { from: ds[0]!, to: ds[ds.length - 1]! };
  })();
  const spanFrom = dialogSpan.from, spanTo = dialogSpan.to;
  useEffect(() => {
    if (!spanFrom || !spanTo) return;
    let live = true;
    void api<{ leave: LeaveSpan[] }>(`/leave/calendar?from=${spanFrom}&to=${spanTo}`)
      .then((r) => { if (live && r.ok && Array.isArray(r.data?.leave)) setSpanLeave(r.data.leave); });
    return () => { live = false; };
  }, [spanFrom, spanTo]);

  /** The (host, day) pairs in the current form that are closed by approved
      leave. De-duplicated — a host can sit in the picker and in the chip row
      at once, and naming their Thursday twice reads like two problems. */
  const leaveHits = (): { key: string; name: string; date: string }[] => {
    const seen = new Set<string>();
    const out: { key: string; name: string; date: string }[] = [];
    for (const dt of expandDates()) {
      for (const h of hostIds()) {
        const k = `${h}|${dt}`;
        if (!onLeaveAt(h, dt, draft.start_time, draft.end_time) || seen.has(k)) continue;
        seen.add(k);
        out.push({ key: k, name: hostShort(h), date: dt });
      }
    }
    return out;
  };

  /** How many sessions THIS press would actually create — leave days already
      removed. A button that promises ten and creates eight is a button that
      lied, and the eight would look like the ten until somebody counted. */
  const usableCount = (): number => {
    const hosts = hostIds();
    if (hosts.length === 0) return 0;
    const all = expandDates().flatMap((dt) => hosts.map((h) => ({ dt, h })));
    return Math.min(MAX_PER_PRESS, (leaveOverride ? all : all.filter((e) => !onLeaveAt(e.h, e.dt, draft.start_time, draft.end_time))).length);
  };

  /** Validate the form + repeat rule; toast and return null when unusable. */
  /** v1.29.5 — the ceiling on ONE press of Schedule. expandDates() already
      caps a run at 62 days; multiplying by hosts could otherwise fire 300+
      writes from a single click. When the product exceeds this the extra
      entries are dropped and SAID SO (see expandOrExplain) — a silent
      truncation would read as "scheduled everything" when it did not. */
  const MAX_PER_PRESS = 120;

  const expandOrExplain = (): PlanEntry[] | null => {
    const hosts = hostIds();
    if (!draft.session_date || !draft.start_time || hosts.length === 0) {
      showToast(L("No change", "Tiada perubahan"), L("Date, start time and host are required", "Tarikh, masa mula dan hos diperlukan"), "notice");
      return null;
    }
    if (repeat !== "once" && (!repeatUntil || repeatUntil < draft.session_date)) {
      showToast(L("Set the until date", "Tetapkan tarikh sehingga"), L("Repeat needs an end — pick the last date the run should reach.", "Ulangan perlukan penghujung — pilih tarikh terakhir yang perlu dicapai."), "notice");
      return null;
    }
    if (repeat === "days" && repeatDays.length === 0) {
      showToast(L("Pick the days", "Pilih hari"), L("Toggle at least one weekday (Mon–Sun) for the run.", "Togol sekurang-kurangnya satu hari (Isn–Ahd) untuk ulangan ini."), "notice");
      return null;
    }
    /* One session per host per date: the database row IS one host, and the
       grid, hour totals and notifications all count on that. */
    const everything = expandDates().flatMap((dt) =>
      hosts.map((h) => ({ ...draft, session_date: dt, host_user_id: h })),
    );
    /* v1.131.0 — approved leave days come OUT, per host. On a two-host run
       the one who is away loses their Thursday and the other one keeps it:
       dropping the whole date would cancel a colleague's session over
       somebody else's holiday. The strip under the picker names what left,
       so a run that quietly got shorter never looks like the one that was
       asked for. */
    const all = leaveOverride
      ? everything
      : everything.filter((e) => !onLeaveAt(e.host_user_id, e.session_date, e.start_time, e.end_time));
    if (all.length === 0) {
      const first = everything[0];
      showToast(
        L("Not available", "Tidak tersedia"),
        first
          ? L(`${hostShort(first.host_user_id)} is on approved leave on ${dmy(first.session_date)}. Pick another day, or another person.`,
              `${hostShort(first.host_user_id)} bercuti (diluluskan) pada ${dmy(first.session_date)}. Pilih hari lain, atau orang lain.`)
          : L("Every day in this run is approved leave.", "Setiap hari dalam ulangan ini ialah cuti diluluskan."),
        "notice");
      return null;
    }
    if (all.length > MAX_PER_PRESS) {
      const kept = all.slice(0, MAX_PER_PRESS);
      showToast(
        L("Too many at once", "Terlalu banyak sekali gus"),
        lang === "ms"
          ? `${all.length} sesi diminta — ${MAX_PER_PRESS} pertama sahaja disediakan. Pendekkan julat ulangan atau kurangkan hos, kemudian ulang untuk bakinya.`
          : `${all.length} sessions asked for — only the first ${MAX_PER_PRESS} are queued. Shorten the repeat range or pick fewer hosts, then repeat for the rest.`,
        "notice",
      );
      return kept;
    }
    return all;
  };

  const addToPlan = () => {
    const entries = expandOrExplain();
    if (!entries) return;
    setPlan((p) => {
      const key = (e: PlanEntry) => `${e.session_date}|${e.start_time}|${e.host_user_id}`;
      const seen = new Set(p.map(key));
      const fresh = entries.filter((e) => !seen.has(key(e)));
      return [...p, ...fresh].slice(0, 100).sort((a, b) => `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`));
    });
    showToast(L("Added to plan", "Ditambah ke pelan"), lang === "ms"
      ? `${entries.length} sesi dalam giliran — laraskan borang dan tambah lagi, atau Jadualkan semua.`
      : `${entries.length} session${entries.length === 1 ? "" : "s"} queued — adjust the form and add more, or Schedule all.`);
    setRepeat("once"); setRepeatUntil(""); setRepeatDays([]);
  };

  const saveAssign = async () => {
    /* SCHEDULE = the plan if one exists; otherwise the form (× repeat). */
    let batch: PlanEntry[];
    if (plan.length > 0) batch = plan;
    else {
      const entries = expandOrExplain();
      if (!entries) return;
      batch = entries;
    }
    setSaving(true);
    let ok = 0; const fails: string[] = [];
    for (const e of batch) {
      const r = await api<{ error?: { message?: string } }>(`/live-sessions`, {
        method: "POST",
        body: JSON.stringify({ ...e, host_user_id: Number(e.host_user_id),
                               ...(leaveOverride ? { leave_override: true } : {}) }),
      });
      if (r.ok) ok++;
      else fails.push(`${dmy(e.session_date)} ${e.start_time}${r.data?.error?.message ? ` (${r.data.error.message})` : ""}`);
    }
    setSaving(false);
    if (ok === 0) { showToast(L("No change", "Tiada perubahan"), fails[0] ?? L("Could not schedule", "Tidak dapat dijadualkan"), "notice"); return; }
    showToast(
      ok === 1 && batch.length === 1 ? L("Scheduled", "Dijadualkan") : (lang === "ms" ? `${ok} sesi dijadualkan` : `Scheduled ${ok} session${ok === 1 ? "" : "s"}`),
      fails.length > 0 ? L(`${fails.length} failed: ${fails[0]}`, `${fails.length} gagal: ${fails[0]}`) : (batch.length === 1 ? `${batch[0]!.client_name || L("Live session", "Sesi LIVE")} · ${dmy(batch[0]!.session_date)} ${batch[0]!.start_time}` : L("Each host has been notified", "Setiap hos telah dimaklumkan")),
      fails.length > 0 ? "notice" : undefined,
    );
    setAssignOpen(false);
    setExtraHosts([]);
    void load(week);
  };

  if (notReady) {
    return <div className={card}><PanelTitle icon="date">{L("Schedule & Roster", "Jadual & Roster")}</PanelTitle>
      <p className="text-muted-foreground mt-1 text-xs">The roster needs the latest Worker deploy (and migration 0056).</p></div>;
  }
  if (!data) {
    return <div className={card}><PanelTitle icon="date">{L("Schedule & Roster", "Jadual & Roster")}</PanelTitle>
      {failed
        ? <p className="text-muted-foreground mt-2 text-sm">{L("Could not load the week —", "Minggu tidak dapat dimuatkan —")} <button type="button" className="underline" onClick={() => void load(week)}>{L("try again", "cuba lagi")}</button>.</p>
        : (
          /* v1.77.0 — skeleton until the first fetch lands. Same geometry as
             the loaded board: stat chips, the 240/1fr/230 rails on xl, a
             7-column week grid on desktop and the agenda list on phones. */
          <>
            <div className="mt-3 flex flex-wrap gap-2" aria-hidden>
              <Skel className="h-7 w-20" />
              <Skel className="h-7 w-24" />
              <Skel className="h-7 w-32" />
              <Skel className="h-7 w-28" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr_230px]" aria-hidden>
              <div className="hidden xl:block">
                <Skel className="h-56 w-full" />
                <Skel className="mt-3 h-24 w-full" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Skel className="h-7 w-16" />
                    <Skel className="h-7 w-8" />
                    <Skel className="h-7 w-8" />
                    <Skel className="h-7 w-28" />
                  </div>
                  <Skel className="h-4 w-44" />
                </div>
                <div className="mt-2 hidden grid-cols-7 gap-2 md:grid">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i} className="space-y-2">
                      <Skel className="h-3 w-full" />
                      <Skel className="h-16 w-full" />
                      <Skel className={`w-full ${i % 2 === 0 ? "h-24" : "h-12"}`} />
                      <Skel className="h-16 w-full" />
                    </div>
                  ))}
                </div>
                <SkelRows rows={7} className="mt-2 md:hidden" />
              </div>
              <div className="hidden xl:block">
                <Skel className="h-40 w-full" />
                <Skel className="mt-3 h-32 w-full" />
              </div>
            </div>
          </>
        )}
    </div>;
  }

  const active = data.sessions.filter((s) => s.status !== "cancelled");
  const conflictIds = new Set(data.conflicts.flatMap((c) => c.session_ids));
  /* v1.66.0 — task blocks, and the conflicts that belong to them. Soft
     conflicts (a task under a live session) are kept apart from hard ones:
     amber says "this will have to move", red says "this cannot happen". */
  const blocks: RosterTaskBlock[] = data.task_blocks ?? [];
  const unsched: UnscheduledTask[] = data.unscheduled ?? [];
  /* v1.158.0 - sales duty, the third thing on the board. */
  const shifts: SalesShift[] = data.sales_shifts ?? [];
  /* v1.171.0 - the calendar, the fourth. `evFor` is what the CEO asked for -
     an event assigned to a person, on that person's row; `evAll` is the
     whole-floor kind, which belongs to the day. */
  const events: RosterEvent[] = data.events ?? [];
  const evTime = (e: RosterEvent) => (e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ""}` : L("all day", "sepanjang hari"));
  const evFor = (uid: number, d: string) =>
    events.filter((e) => e.event_date === d && e.attendees.includes(uid));
  const evAll = (d: string) => events.filter((e) => e.event_date === d && e.attendees.length === 0);
  const evTitle = (e: RosterEvent) =>
    `${e.title} · ${evTime(e)}${e.location ? ` · ${e.location}` : ""} · ${e.attendees.length === 0 ? L("everyone", "semua") : L(`${e.attendees.length} assigned`, `${e.attendees.length} ditugaskan`)}`;
  const shiftMins = (sh: SalesShift) => spanMins(sh.start_time, sh.end_time);
  /* the chip is 90px wide: "RM 2,000.00" does not fit beside SALES, "RM2,000" does */
  const rmShort = (cents: number) => `RM${Math.round(cents / 100).toLocaleString("en-MY")}`;
  const shiftCls = (sh: SalesShift) =>
    sh.shift_date < todayS && sh.evidence === 0
      ? "border-warning bg-warning-soft"
      : "border-info bg-info-soft";
  const shiftTitle = (sh: SalesShift) =>
    `${L("Sales duty", "Tugas jualan")} · ${sh.start_time}–${sh.end_time} · ${sh.user_name}`
    + (sh.target_cents != null ? ` · ${L("target", "sasaran")} ${fmtRM(sh.target_cents)}` : "")
    + (sh.focus ? ` — ${sh.focus}` : "")
    + (sh.shift_date <= todayS ? ` · ${sh.evidence === 0 ? L("no evidence logged", "tiada bukti direkod") : L(`${sh.evidence} on the register`, `${sh.evidence} dalam daftar`)}` : "");
  const hardBlockIds = new Set(
    data.conflicts.filter((c) => !c.soft).flatMap((c) => c.task_block_ids ?? []));
  const softBlockIds = new Set(
    data.conflicts.filter((c) => c.soft).flatMap((c) => c.task_block_ids ?? []));
  const onLeaveCount = new Set(data.on_leave.map((l) => l.user_id)).size;
  /* v1.158.4 (CEO: "should appear of their off-day which is need to add into
     the Attendance based on their working day and hours pattern") */
  const offAt = (uid: number, d: string) => (data.rest_days ?? []).find((r) => r.user_id === uid && r.date === d);
  /* v1.158.5 (CEO, on seeing "Off day" beside a booked live: "something not
     right at here") - the tag is for a day with NOTHING on it. Work booked on
     a rest day is the plan the CEO made; the pattern's rest day yields to it
     on the board, and shows only as a hint on the chip. */
  const bookedAt = (uid: number, d: string) =>
    active.some((s) => s.host_user_id === uid && s.session_date === d)
    || blocks.some((b) => b.user_id === uid && b.block_date === d)
    || shifts.some((x) => x.user_id === uid && x.shift_date === d);
  const offOnly = (uid: number, d: string) => offAt(uid, d) && !bookedAt(uid, d) ? offAt(uid, d) : undefined;
  const gridHeight = (DAY_END - DAY_START) * HOUR_PX;
  const sel = data.sessions.find((s) => s.id === openSession) ?? null;
  /* v1.21.2 (CEO: "should appear the data when I click on the schedule …
     it should appear inside the calendar"): the detail card is a POPOVER
     anchored beside the clicked session inside the week grid — no more
     scrolling to a panel underneath the board. Day columns 0–3 open the
     card to the RIGHT of their column, 4–6 to the LEFT, so it never
     leaves the grid. Top follows the session, clamped to stay visible. */
  const selDi = sel ? data.days.indexOf(sel.session_date) : -1;
  const selTop = sel
    ? Math.max(4, Math.min(gridHeight - 220, ((mins(sel.start_time) - DAY_START * 60) / 60) * HOUR_PX))
    : 0;
  const COL = "((100% - 48px) / 7)";
  const selPos: { left?: string; right?: string } = selDi >= 0 && selDi <= 3
    ? { left: `calc(48px + ${selDi + 1} * ${COL} + 6px)` }
    : { right: `calc(${7 - selDi} * ${COL} + 6px)` };

  const chip = (label: string, value: number, cls: string) => (
    <span className={`${cls} inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium`}>
      <span className="text-sm font-bold tabular-nums">{value}</span> {label}
    </span>
  );

  return (
    /* v1.23.6: belt-and-braces phone clip on the CARD itself (the shell has
       one since v1.23.4) — no build state can ever show this card cut off
       past the screen edge again. */
    <div className={`${card} max-md:overflow-x-clip`}>
      {toastNode}
      {confirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <PanelTitle icon="date">{L("Schedule & Roster", "Jadual & Roster")}</PanelTitle>
          <p className="text-muted-foreground mt-0.5 text-xs">{L("Plan live sessions and task work on one week: assignments, availability and replacements.", "Rancang sesi LIVE dan kerja tugasan dalam satu minggu: tugasan, ketersediaan dan pengganti.")}</p>
        </div>
        {/* v1.66.0 — "+ New assignment" no longer means one thing.
            A menu rather than two buttons: the header is tight on a phone,
            and the second option is used far less often than the first. */}
        {canManage && (
          <div className="relative">
            <button type="button" className={btnClass} onClick={() => setNewMenu((o) => !o)}
              aria-expanded={newMenu} aria-haspopup="menu">
              ＋ {L("New assignment", "Tugasan baharu")}
            </button>
            {newMenu && (
              <div role="menu"
                className="bg-card border-border absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border shadow-xl">
                <button type="button" role="menuitem"
                  className="hover:bg-secondary block w-full px-3 py-2 text-left text-sm"
                  onClick={() => { setNewMenu(false); openAssign(); }}>
                  <span className="font-medium">{L("Live session", "Sesi LIVE")}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {L("A host, a platform, a client slot", "Hos, platform, slot pelanggan")}
                  </span>
                </button>
                <button type="button" role="menuitem"
                  className="hover:bg-secondary border-border block w-full border-t px-3 py-2 text-left text-sm"
                  onClick={() => { setNewMenu(false); setTaskOpen(true); }}>
                  <span className="font-medium">{L("Task", "Tugasan")}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {L("Assigned and scheduled in one step", "Ditugaskan dan dijadualkan sekali gus")}
                  </span>
                </button>
                {/* v1.158.0 (CEO: "beside of Assigned Live, I need to assigned
                    them to perform Sales for the Sales person ... based on the
                    day/date that I pick and assigned") */}
                <button type="button" role="menuitem"
                  className="hover:bg-secondary border-border block w-full border-t px-3 py-2 text-left text-sm"
                  onClick={() => { setNewMenu(false); setEditingShift(null); setSDraft({ user_id: "", shift_date: todayS, start_time: "10:00", end_time: "18:00", target: "", focus: "" }); setSalesOpen(true); }}>
                  <span className="font-medium">{L("Sales duty", "Tugas jualan")}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {L("A sales person, the days you pick, a target", "Orang jualan, hari yang anda pilih, sasaran")}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* stat chips (reference: Scheduled / Available / On leave / Conflicts) */}
      <div className="mt-3 flex flex-wrap gap-2">
        {chip(L("live", "LIVE"), active.length, "bg-secondary")}
        {chip(L("tasks", "tugasan"), blocks.length,
              "border border-plan bg-plan-soft")}
        {shifts.length > 0 && chip(L("sales duty", "tugas jualan"), shifts.length, "border border-info bg-info-soft")}
        {/* v1.171.0 - the calendar's own count, so a week with a training in
            it says so before anybody books over the training. */}
        {events.length > 0 && chip(L("events", "acara"), events.length, "border border-gold bg-gold-soft/50")}
        {data.manager && chip(L("available today", "tersedia hari ini"), data.available_today.length, chipSuccess)}
        {/* v1.157.0 - the week's public holidays, named, so the plan is read
            with the non-working day in view before anything is booked on it. */}
        {data.days.filter((d) => holidayAt(d)).map((d) => (
          <span key={d} className="bg-danger-soft text-danger inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium" title={L("Public holiday — not a working day", "Cuti umum — bukan hari bekerja")}>
            <AppIcon name="holiday" className="h-3.5 w-3.5" />
            <span className="font-semibold">{DAYS[data.days.indexOf(d)]} {d.slice(8)}</span> · {holidayLabel(holidayAt(d)!)}
          </span>
        ))}
        {/* v1.21.0: the on-leave pill is a button — it opens WHO is away and
            the applied dates, so assignments are planned around real absences
            without leaving this board. */}
        <button type="button" disabled={onLeaveCount === 0} onClick={() => setLeaveOpen((o) => !o)}
          aria-expanded={leaveOpen}
          className={`${chipNeutral} inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${onLeaveCount > 0 ? "cursor-pointer hover:opacity-80" : ""}`}>
          <span className="text-sm font-bold tabular-nums">{onLeaveCount}</span>
          {data.manager ? L("on leave", "bercuti") : L("my leave days", "hari cuti saya")}
          {onLeaveCount > 0 && <span aria-hidden className="text-[10px]">{leaveOpen ? "▲" : "▼"}</span>}
        </button>
        {chip(L("conflicts", "pertindihan"), data.conflicts.length, data.conflicts.length ? chipWarn : "bg-secondary")}
      </div>
      {leaveOpen && onLeaveCount > 0 && (
        <div className="border-border mt-2 rounded-lg border p-3">
          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("On approved leave this week", "Cuti diluluskan minggu ini")}</p>
          <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {data.on_leave.map((l, i) => (
              <p key={`${l.user_id}-${i}`} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">{l.name}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {l.start_date === l.end_date ? dmy(l.start_date) : `${dmy(l.start_date)} → ${dmy(l.end_date)}`}
                  {isPartialLeave(l) && ` · ${l.day_part === "first_half" ? L("First half", "Separuh pertama") : l.day_part === "second_half" ? L("Second half", "Separuh kedua") : L("Coverage needs review", "Tempoh perlu disemak")}`}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr_230px]">
        {/* left rail: mini calendar (xl+) */}
        <div className="hidden xl:block">
          <MiniCalendar
            selected={data.week_start}
            marked={new Set(active.map((s) => s.session_date))}
            holidays={holidays}
            onPick={(d) => setWeek(mondayOf(d))}
          />
          <div className="border-border mt-3 rounded-lg border p-3">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{L("Today", "Hari ini")}</p>
            {active.filter((s) => s.session_date === todayS).length === 0
              ? <p className="text-muted-foreground mt-1.5 text-xs">{L("No sessions today.", "Tiada sesi hari ini.")}</p>
              : active.filter((s) => s.session_date === todayS).map((s) => (
                <button key={s.id} type="button" onClick={() => setOpenSession(s.id)}
                  className="border-border mt-1.5 block w-full rounded-lg border px-2.5 py-1.5 text-left text-xs hover:bg-secondary">
                  <span className="font-semibold tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</span> {s.client ?? "Live"}
                  <span className="text-muted-foreground block">{s.host_name.split(" ")[0]} · {s.platform}</span>
                </button>
              ))}
          </div>
        </div>

        {/* the week grid */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={btnSm} onClick={() => { if (week === "") void load(""); else setWeek(""); }}>{L("Today", "Hari ini")}</button>
              <button type="button" className={btnSm} aria-label="Previous week" onClick={() => setWeek(shiftWeek(data.week_start, -1))}>‹</button>
              <button type="button" className={btnSm} aria-label="Next week" onClick={() => setWeek(shiftWeek(data.week_start, 1))}>›</button>
              {/* v1.22.2 (CEO: "generate 1 schedule table in PDF so that I
                  can share to them for their awareness"): the loaded week as
                  a branded PDF, straight into the phone's share sheet. */}
              <button type="button" className={btnSm}
                onClick={async () => {
                  /* v1.22.4: the PDF is the staff×day grid now — same table
                     the screen shows, landscape A4. */
                  /* v1.69.1: the task blocks go with them. A shared plan
                     that shows half the week is worse than no shared plan —
                     it tells the marketing team they are free. */
                  /* v1.158.3 (CEO: "on PDF I cant see there is a Public
                     Holiday!"): the holidays and the sales duty go with them
                     - the sheet prints what the board shows, all of it. */
                  const how = await shareRosterPdf(
                    data.days, data.sessions, staff, data.on_leave,
                    data.conflicts.flatMap((cf) => cf.session_ids), "AZ ONE staff portal",
                    blocks, [...hardBlockIds, ...softBlockIds],
                    { holidays: data.days.filter((d) => holidayAt(d)).map((d) => ({ date: d, name: holidayAt(d)!.name })), shifts, restDays: (data.rest_days ?? []).filter((r) => !bookedAt(r.user_id, r.date)) });
                  if (how === "cancelled") return;
                  showToast(how === "shared" ? L("Shared", "Dikongsi") : L("Downloaded", "Dimuat turun"),
                    `${L("Week roster PDF", "PDF roster minggu")} · ${dmy(data.days[0]!)} – ${dmy(data.days[6]!)}`
                    + (blocks.length > 0 ? ` · ${data.sessions.length} ${L("live", "LIVE")} + ${blocks.length} ${L("tasks", "tugasan")}` : ""));
                }}>
                {L("PDF — share plan", "PDF — kongsi pelan")}
              </button>
              {/* v1.22.3 — view toggle (desktop only; phones keep the agenda). */}
              <span className="border-border ml-1 hidden overflow-hidden rounded-lg border text-xs md:inline-flex">
                {([["grid", L("Staff grid", "Grid staf")], ["timeline", L("Timeline", "Garis masa")]] as const).map(([v, l]) => (
                  <button key={v} type="button"
                    className={`px-2.5 py-1 font-medium ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
                    onClick={() => setView(v)}>{l}</button>
                ))}
              </span>
            </div>
            <p className="text-sm font-medium tabular-nums">{L("Week of", "Minggu")} {dmy(data.days[0]!)} – {dmy(data.days[6]!)}</p>
          </div>
          {/* v1.22.3 — STAFF GRID (desktop default): staff rows × day
              columns, the CEO's reference layout in AZ ONE colours. */}
          {view === "grid" && (
            <div className="mt-2 hidden overflow-x-auto md:block">
              <div ref={gridRef} className="border-border relative min-w-[760px] overflow-hidden rounded-lg border">
                {(() => {
                  const durOf = (s: RosterSession) => (s.end_time ? Math.max(30, spanMins(s.start_time, s.end_time)) : 60);
                  const hrs = (m: number) => `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)} ${L("hrs", "jam")}`;
                  const nSess = (n: number) => (lang === "ms" ? `${n} sesi` : `${n} session${n === 1 ? "" : "s"}`);
                  /* v1.66.0: a block's own duration, and the week's real
                     commitment — live plus task, because "129 hrs" only
                     answers "is this person overloaded" once it counts
                     everything they are actually booked for. */
                  const durOfB = (b: RosterTaskBlock) => (b.end_time ? Math.max(30, spanMins(b.start_time, b.end_time)) : 60);
                  const cellTasks = (uid: number, d: string) =>
                    blocks.filter((b) => b.user_id === uid && b.block_date === d)
                      .sort((a, b) => a.start_time.localeCompare(b.start_time));
                  const blkCls = (b: RosterTaskBlock) =>
                    /* Done wins over every other state. A day that happened
                       is not a conflict and not a warning; it is history. */
                    b.done_at ? "border-success bg-success-soft opacity-70"
                    : hardBlockIds.has(b.id) ? "border-danger bg-danger-soft"
                    : softBlockIds.has(b.id) ? "border-warning bg-warning-soft"
                    : b.status === "completed" ? "border-success bg-success-soft"
                    /* Violet, from Tailwind's own palette rather than a brand
                       token: the brand colours are already spoken for by
                       TikTok, Shopee, completed, conflict and leave, and an
                       invented token would render as no colour at all. */
                    : "border-plan bg-plan-soft";
                  /* v1.131.0: one definition of "away", shared with the
                     dialogs and the drag handler (onLeaveAt, above). This used
                     to be a second copy that read only the week's list. */
                  const rows = staff;
                  const cellSessions = (uid: number, d: string) =>
                    active.filter((s) => s.host_user_id === uid && s.session_date === d)
                      .sort((a, b) => a.start_time.localeCompare(b.start_time));
                  const chipCls = (s: RosterSession) =>
                    conflictIds.has(s.id) ? "border-warning bg-warning-soft"
                    : s.status === "completed" ? "border-success bg-success-soft"
                    : s.platform === "tiktok" ? "border-brand/30 bg-brand/10"
                    : s.platform === "shopee" ? "border-gold bg-gold-soft/60"
                    : "border-border bg-secondary";
                  /* v1.22.5 (CEO: "the grid cell out from it position!"):
                     `1fr` tracks have min-width:auto — a wide chip stretched
                     ITS row's columns and rows drifted out of line with the
                     header. minmax(0,1fr) + min-w-0 cells pin every row to
                     identical tracks; truncation actually truncates now. */
                  const gridCols = { gridTemplateColumns: "170px repeat(7, minmax(0, 1fr))" };
                  return (
                    <>
                      {/* header: staff corner + day columns with totals */}
                      <div className="border-border grid border-b" style={gridCols}>
                        <div className="bg-brand flex min-w-0 flex-col justify-center px-3 py-2">
                          <p className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">{L("Staff", "Staf")}</p>
                          <p className="text-xs font-semibold text-white tabular-nums">
                            {nSess(active.length)}{blocks.length > 0 ? ` · ${blocks.length} ${L("tasks", "tugasan")}` : ""}
                            {" · "}
                            {hrs(active.reduce((a, s) => a + durOf(s), 0) + blocks.reduce((a, b) => a + durOfB(b), 0))}
                          </p>
                        </div>
                        {data.days.map((d, i) => {
                          const dayS = active.filter((s) => s.session_date === d);
                          const dayB = blocks.filter((b) => b.block_date === d);
                          const daySh = shifts.filter((x) => x.shift_date === d);
                          const isToday = d === todayS;
                          const hol = holidayAt(d);
                          return (
                            <div key={d} className={`border-border min-w-0 border-l px-2 py-2 text-center ${isToday ? "bg-gold-soft/40" : hol ? "bg-danger-soft/50" : "bg-secondary/50"}`}
                              title={hol ? holidayLabel(hol) : undefined}>
                              <p className={`text-[11px] font-semibold ${isToday ? "text-gold-deep" : hol ? "text-danger" : ""}`}>{DAYS[i]} <span className="tabular-nums">{d.slice(8)}</span></p>
                              {hol && <p className="text-danger truncate text-[10px] font-medium">{hol.name}</p>}
                              <p className="text-muted-foreground text-[10px] tabular-nums">
                                {dayS.length + dayB.length + daySh.length === 0
                                  ? (hol ? L("holiday", "cuti umum") : "—")
                                  : `${dayS.length + dayB.length + daySh.length} · ${hrs(dayS.reduce((a, s) => a + durOf(s), 0) + dayB.reduce((a, b) => a + durOfB(b), 0) + daySh.reduce((a, x) => a + shiftMins(x), 0))}`}
                              </p>
                              {/* v1.171.0 - an event for the WHOLE FLOOR sits
                                  on the day, once, rather than in nine rows. */}
                              {evAll(d).map((e) => (
                                <p key={`ea${e.id}`} className="border-gold bg-gold-soft/60 text-gold-deep mt-1 truncate rounded-md border px-1 py-0.5 text-[9px] leading-tight font-semibold"
                                  title={evTitle(e)}>
                                  <AppIcon name="date" className="mr-0.5 -mt-0.5 h-2.5 w-2.5" />{e.title}
                                </p>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      {/* one row per staff member */}
                      {rows.map((u) => {
                        const mine = active.filter((s) => s.host_user_id === u.id);
                        const mineB = blocks.filter((b) => b.user_id === u.id);
                        const mineS = shifts.filter((x) => x.user_id === u.id);
                        return (
                          <div key={u.id} className="border-border grid border-b last:border-b-0" style={gridCols}>
                            <div className="border-border flex min-w-0 flex-col justify-center border-r px-3 py-1.5">
                              {/* v1.69.2 (CEO: "I want the table get full
                                  name"): the whole name, wrapped over as many
                                  lines as it needs. Two words was a guess
                                  about who is meant, and two people on this
                                  floor can share their first two. */}
                              <p className="text-xs leading-tight font-semibold break-words" title={u.name}>{u.name}</p>
                              <p className="text-muted-foreground text-[10px] tabular-nums">
                                {mine.length + mineB.length + mineS.length === 0
                                  ? L("nothing booked", "tiada tempahan")
                                  : [
                                      mine.length > 0 ? `${mine.length} ${L("live", "LIVE")}` : "",
                                      mineB.length > 0 ? `${mineB.length} ${L("tasks", "tugasan")}` : "",
                                      mineS.length > 0 ? `${mineS.length} ${L("sales", "jualan")}` : "",
                                      hrs(mine.reduce((a, s) => a + durOf(s), 0) + mineB.reduce((a, b) => a + durOfB(b), 0) + mineS.reduce((a, x) => a + shiftMins(x), 0)),
                                    ].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            {data.days.map((d) => {
                              const cs = cellSessions(u.id, d);
                              const ts = cellTasks(u.id, d);
                              const leave = onLeaveAt(u.id, d);
                              const partialLeave = data.on_leave.some(l => l.user_id === u.id && leaveOverlaps(l, d) && isPartialLeave(l));
                              /* While a task is armed, every cell the current
                                 user is allowed to fill becomes a target. A
                                 non-manager may only place work on their own
                                 row — the same rule the server enforces, said
                                 here so the board never offers something the
                                 save will refuse.
                                 v1.131.0 adds the leave day for exactly that
                                 reason: the server now refuses it, so the cell
                                 must stop offering itself. It is not dimmed or
                                 hidden — the "On leave" tag is the answer to
                                 why it will not take the task. */
                              const canDrop = armed != null && !placing && !leave
                                && (canManage || u.id === armed.assigned_to);
                              return (
                                <div key={d}
                                  title={leave && armed != null
                                    ? L(`${u.name.split(" ").slice(0, 2).join(" ")} is on approved leave this day`,
                                        `${u.name.split(" ").slice(0, 2).join(" ")} bercuti (diluluskan) pada hari ini`)
                                    : undefined}
                                  className={`border-border min-h-12 min-w-0 space-y-1 border-l p-1 ${d === todayS ? "bg-gold-soft/15" : holidayAt(d) ? "bg-danger-soft/20" : offOnly(u.id, d) ? "bg-secondary/60" : ""} ${canDrop ? "ring-gold cursor-copy ring-1 ring-inset" : ""} ${leave && armed != null ? "cursor-not-allowed opacity-60" : ""}`}
                                  onClick={canDrop ? () => void placeTask(armed!, d, u.id) : undefined}>
                                  {leave && (
                                    <div className="bg-danger-soft text-danger rounded-md px-1.5 py-1 text-center text-[10px] font-semibold">{partialLeave ? L("Partial leave", "Cuti separa") : L("On leave", "Bercuti")}</div>
                                  )}
                                  {/* v1.158.4 - the person's own rest day, from
                                      their working-hours pattern. Shown, never
                                      locked: work booked on it is rest-day work. */}
                                  {!leave && offOnly(u.id, d) && (
                                    <div className="text-muted-foreground rounded-md border border-dashed border-border px-1.5 py-1 text-center text-[10px] font-semibold"
                                      title={L(`Rest day on ${offAt(u.id, d)!.pattern}`, `Hari rehat pada ${offAt(u.id, d)!.pattern}`)}>{L("Off day", "Hari cuti")}</div>
                                  )}
                                  {/* v1.171.0 - EVENTS ASSIGNED TO THIS
                                      PERSON, above the work: a training they
                                      have to attend is the fixed point the
                                      rest of the day is planned around. Read
                                      only here - events are created and
                                      edited on the Events card. */}
                                  {evFor(u.id, d).map((e) => (
                                    <div key={`e${e.id}`} title={evTitle(e)}
                                      className="border-gold bg-gold-soft/60 block w-full rounded-md border px-1.5 py-1 text-left">
                                      <span className="text-gold-deep block truncate text-[10px] leading-tight font-semibold">
                                        <AppIcon name="date" className="mr-0.5 -mt-0.5 h-2.5 w-2.5" />{e.title}
                                      </span>
                                      <span className="text-muted-foreground block truncate text-[9px] leading-tight tabular-nums">
                                        {evTime(e)} · {L("event", "acara")}
                                      </span>
                                    </div>
                                  ))}
                                  {cs.map((s) => (
                                    <button key={s.id} type="button"
                                      title={`${s.client ?? "Live"} · ${s.start_time}${s.end_time ? `–${s.end_time}` : ""} · ${s.host_name}${s.notes ? ` — ${s.notes}` : ""}${offAt(u.id, d) ? ` · ${L("booked on their rest day", "ditempah pada hari rehat mereka")}` : ""}`}
                                      onClick={(e) => {
                                        const same = openSession === s.id;
                                        setOpenBlock(null);
                                        setOpenSession(same ? null : s.id);
                                        setNoteAt(same ? null : noteFrom(e.currentTarget, gridRef.current));
                                      }}
                                      className={`block w-full rounded-md border px-1.5 py-1 text-left ${chipCls(s)} ${openSession === s.id && noteAt ? "ring-gold ring-2" : ""}`}>
                                      <span className="block truncate text-[10px] leading-tight font-semibold">{s.client ?? "Live"}</span>
                                      <span className="text-muted-foreground block truncate text-[9px] leading-tight tabular-nums">
                                        {s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {durOf(s)} min
                                      </span>
                                    </button>
                                  ))}
                                  {/* v1.66.0 — the other half of the week.
                                      Live blocks first: a live session is
                                      fixed to the hour it was sold at, and a
                                      task is the thing that moves around it. */}
                                  {ts.map((b) => (
                                    <button key={`t${b.id}`} type="button"
                                      title={`${b.title} · ${b.start_time}${b.end_time ? `–${b.end_time}` : ""} · ${b.user_name}`
                                        + (b.deadline ? ` · ${L("due", "tarikh akhir")} ${dmy(b.deadline)}` : "")
                                        + (hardBlockIds.has(b.id) ? ` · ${L("CONFLICT", "PERTINDIHAN")}` : "")
                                        + (softBlockIds.has(b.id) ? ` · ${L("clashes with a live session — move the task", "bertindih dengan sesi LIVE — alihkan tugasan")}` : "")}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const same = openBlock === b.id;
                                        setOpenSession(null);
                                        setOpenBlock(same ? null : b.id);
                                        setNoteAt(same ? null : noteFrom(e.currentTarget, gridRef.current));
                                      }}
                                      className={`block w-full rounded-md border px-1.5 py-1 text-left ${blkCls(b)} ${openBlock === b.id && noteAt ? "ring-gold ring-2" : ""}`}>
                                      <span className={`block truncate text-[10px] leading-tight font-semibold ${b.done_at ? "line-through" : ""}`}>
                                        {b.done_at ? "✓ " : b.priority === "urgent" ? "❗ " : ""}{b.title}
                                      </span>
                                      <span className="text-muted-foreground block truncate text-[9px] leading-tight tabular-nums">
                                        {b.start_time}{b.end_time ? `–${b.end_time}` : ""} · {L("task", "tugasan")}
                                      </span>
                                    </button>
                                  ))}
                                  {/* v1.158.0 - sales duty. Amber once the day
                                      has passed with nothing on the register:
                                      a planned sales day that left no trace is
                                      exactly what the CEO asked to see. */}
                                  {shifts.filter((sh) => sh.user_id === u.id && sh.shift_date === d).map((sh) => (
                                    <button key={`s${sh.id}`} type="button" title={shiftTitle(sh)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const same = openShift === sh.id;
                                        setOpenSession(null); setOpenBlock(null);
                                        setOpenShift(same ? null : sh.id);
                                        setNoteAt(same ? null : noteFrom(e.currentTarget, gridRef.current));
                                      }}
                                      className={`block w-full rounded-md border px-1.5 py-1 text-left ${shiftCls(sh)} ${openShift === sh.id && noteAt ? "ring-gold ring-2" : ""}`}>
                                      <span className="block truncate text-[10px] leading-tight font-semibold">
                                        {sh.shift_date < todayS && sh.evidence === 0 ? <AppIcon name="warning" className="mr-1 -mt-0.5 h-3 w-3" /> : null}{L("SALES", "JUALAN")}{sh.target_cents != null ? ` · ${rmShort(sh.target_cents)}` : ""}
                                      </span>
                                      <span className="text-muted-foreground block truncate text-[9px] leading-tight tabular-nums">
                                        {sh.start_time}–{sh.end_time}{sh.shift_date <= todayS ? ` · ${sh.evidence} ${L("logged", "direkod")}` : ""}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {/* v1.142.0 - the note opens on the chip that was
                          pressed, not in the middle of the board. */}
                      {sel && noteAt && (
                        <StickyNote at={noteAt}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold">{sel.client ?? L("Live session", "Sesi LIVE")}
                              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${sel.status === "completed" ? "bg-bull/30" : sel.status === "cancelled" ? "bg-bear/30" : "bg-white/15"}`}>{statusLabel(sel.status)}</span>
                            </p>
                            <button type="button" className={iconBtnInverse} onClick={() => { setOpenSession(null); setNoteAt(null); }} aria-label="Close">✕</button>
                          </div>
                          <p className="mt-1.5 text-xs text-white/85">{sel.host_name}</p>
                          <p className="mt-0.5 text-xs text-white/85 tabular-nums">{dmy(sel.session_date)} · {sel.start_time}{sel.end_time ? `–${sel.end_time}` : ""} · {sel.platform}</p>
                          {sel.notes && <p className="mt-1 text-xs text-white/70">{sel.notes}</p>}
                          {canManage && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {canEdit && sel.status !== "cancelled" && (
                                <button type="button" className={btnSmInverse}
                                  onClick={() => openEdit(sel)}>
                                  {L("Edit details", "Sunting butiran")}
                                </button>
                              )}
                              {sel.status === "scheduled" && (
                                <button type="button" className={btnSmInverse}
                                  onClick={() => void setSessionStatus(sel, "completed")}>
                                  {L("✓ Mark completed", "✓ Tanda selesai")}
                                </button>
                              )}
                              {sel.status !== "cancelled" && (
                                <button type="button" className={btnSmInverse}
                                  onClick={() => void setSessionStatus(sel, "cancelled")}>
                                  {L("✕ Cancel session", "✕ Batalkan sesi")}
                                </button>
                              )}
                            </div>
                          )}
                        </StickyNote>
                      )}
                      {(() => {
                        /* v1.142.0 - a task gets the same note in the grid.
                           The bar under the board stays for the mobile agenda,
                           where there is no chip to point at. */
                        const b = blocks.find((x) => x.id === openBlock);
                        if (!b || !noteAt) return null;
                        const hard = hardBlockIds.has(b.id);
                        const soft = softBlockIds.has(b.id);
                        return (
                          <StickyNote at={noteAt}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold">
                                {b.done_at ? "✓ " : b.priority === "urgent" ? "❗ " : ""}{b.title}
                                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${b.done_at ? "bg-bull/30" : hard ? "bg-bear/30" : "bg-white/15"}`}>
                                  {b.done_at ? L("done today", "selesai hari ini") : L("task", "tugasan")}
                                </span>
                              </p>
                              <button type="button" className={iconBtnInverse} onClick={() => { setOpenBlock(null); setNoteAt(null); }} aria-label="Close">✕</button>
                            </div>
                            <p className="mt-1.5 text-xs text-white/85">{b.user_name}</p>
                            <p className="mt-0.5 text-xs text-white/85 tabular-nums">
                              {dmy(b.block_date)} · {b.start_time}{b.end_time ? `–${b.end_time}` : ""}
                              {b.deadline ? ` · ${L("due", "tarikh akhir")} ${dmy(b.deadline)}` : ""}
                            </p>
                            {hard && (
                              <p className="mt-1 text-xs font-medium text-white/90">
                                {b.deadline && b.block_date > b.deadline
                                  ? L("Scheduled AFTER its own deadline.", "Dijadualkan SELEPAS tarikh akhirnya sendiri.")
                                  : L("Clashes with approved leave or another task.", "Bertindih dengan cuti diluluskan atau tugasan lain.")}
                              </p>
                            )}
                            {soft && (
                              <p className="mt-1 text-xs font-medium text-white/90">
                                {L("Overlaps a live session — the live is fixed, so move the task.", "Bertindih dengan sesi LIVE — LIVE tetap, jadi alihkan tugasan.")}
                              </p>
                            )}
                            {canManage && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" className={btnSmInverse}
                                  onClick={() => void setBlockDone(b, !b.done_at)}>
                                  {b.done_at ? L("↺ Not done after all", "↺ Belum selesai") : L("✓ Done today", "✓ Selesai hari ini")}
                                </button>
                                <button type="button" className={btnSmInverse}
                                  onClick={() => openEditBlock(b)}>
                                  {L("Edit details", "Sunting butiran")}
                                </button>
                                {/* v1.171.0 (CEO: "on the attendance, the Task
                                    should be able to delete!") — the grid's own
                                    note, where he was pressing. Unschedule takes
                                    the work off the day and keeps the task;
                                    these two are deliberately different words. */}
                                <button type="button" className={btnSmInverse}
                                  onClick={() => void unscheduleBlock(b)}>
                                  {L("Unschedule", "Nyahjadual")}
                                </button>
                                {canDeleteTask && (
                                  <button type="button" className="erp-button erp-button-danger h-8 min-h-8 px-3 text-xs"
                                    onClick={() => void deleteTask(b.task_id, b.title, blocks.filter((x) => x.task_id === b.task_id).length)}>
                                    {L("Delete task", "Padam tugasan")}
                                  </button>
                                )}
                              </div>
                            )}
                          </StickyNote>
                        );
                      })()}
                      {(() => {
                        /* v1.158.0 - the sales-duty note: the plan, and what
                           the register says happened. */
                        const sh = shifts.find((x) => x.id === openShift);
                        if (!sh || !noteAt) return null;
                        const past = sh.shift_date <= todayS;
                        return (
                          <StickyNote at={noteAt}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold">
                                {L("Sales duty", "Tugas jualan")}
                                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${past && sh.evidence === 0 ? "bg-bear/30" : past ? "bg-bull/30" : "bg-white/15"}`}>
                                  {!past ? L("planned", "dirancang") : sh.evidence === 0 ? L("no evidence", "tiada bukti") : L(`${sh.evidence} on the register`, `${sh.evidence} dalam daftar`)}
                                </span>
                              </p>
                              <button type="button" className={iconBtnInverse} onClick={() => { setOpenShift(null); setNoteAt(null); }} aria-label="Close">✕</button>
                            </div>
                            <p className="mt-1.5 text-xs text-white/85">{sh.user_name}</p>
                            <p className="mt-0.5 text-xs text-white/85 tabular-nums">
                              {dmy(sh.shift_date)} · {sh.start_time}–{sh.end_time} · {hrs(shiftMins(sh))}
                              {sh.target_cents != null ? ` · ${L("target", "sasaran")} ${fmtRM(sh.target_cents)}` : ""}
                            </p>
                            {sh.focus && <p className="mt-1 text-xs text-white/70">{sh.focus}</p>}
                            <p className="mt-1 text-[11px] text-white/70">
                              {past
                                ? L("What was done that day is read from the Sales Performance register — a planned day earns nothing by itself.",
                                    "Apa yang dibuat pada hari itu dibaca daripada daftar Prestasi Jualan — hari yang dirancang tidak mendapat kredit dengan sendirinya.")
                                : L("They log posts, engagements and outcomes on the Sales Performance tab as the day happens.",
                                    "Mereka merekod hantaran, interaksi dan hasil di tab Prestasi Jualan sepanjang hari.")}
                            </p>
                            {(canManage || onOpenRegister) && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {onOpenRegister && (
                                  <button type="button" className={btnSmInverse}
                                    onClick={() => onOpenRegister(sh.user_id, sh.shift_date)}>
                                    {L("Open the register", "Buka daftar")}
                                  </button>
                                )}
                                {canManage && (<>
                                <button type="button" className={btnSmInverse}
                                  onClick={() => openEditShift(sh)}>
                                  {L("Edit details", "Sunting butiran")}
                                </button>
                                <button type="button" className={btnSmInverse}
                                  onClick={() => void removeShift(sh)}>
                                  {L("✕ Remove from the plan", "✕ Buang dari rancangan")}
                                </button>
                                </>)}
                              </div>
                            )}
                          </StickyNote>
                        );
                      })()}
                      {/* legend */}
                      <div className="border-border text-muted-foreground flex flex-wrap gap-3 border-t px-3 py-1.5 text-[10px]">
                        <span className="inline-flex items-center gap-1"><span className="border-brand/30 bg-brand/10 h-2.5 w-2.5 rounded-sm border" />TikTok</span>
                        <span className="inline-flex items-center gap-1"><span className="border-gold bg-gold-soft/60 h-2.5 w-2.5 rounded-sm border" />Shopee</span>
                        <span className="inline-flex items-center gap-1"><span className="border-border bg-secondary h-2.5 w-2.5 rounded-sm border" />{L("Other", "Lain-lain")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-success bg-success-soft h-2.5 w-2.5 rounded-sm border" />{L("Completed", "Selesai")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-warning bg-warning-soft h-2.5 w-2.5 rounded-sm border" />{L("Conflict", "Pertindihan")}</span>
                        <span className="inline-flex items-center gap-1"><span className="bg-danger-soft h-2.5 w-2.5 rounded-sm" />{L("On leave", "Bercuti")}</span>
                        <span className="inline-flex items-center gap-1"><span className="bg-danger-soft/40 border-danger/40 h-2.5 w-2.5 rounded-sm border" />{L("Public holiday", "Cuti umum")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-border bg-secondary/60 h-2.5 w-2.5 rounded-sm border border-dashed" />{L("Off day", "Hari cuti")}</span>
                        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-plan bg-plan-soft" />{L("Task", "Tugasan")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-gold bg-gold-soft/60 h-2.5 w-2.5 rounded-sm border" />{L("Event", "Acara")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-info bg-info-soft h-2.5 w-2.5 rounded-sm border" />{L("Sales duty", "Tugas jualan")}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* v1.21.8 (CEO: "It overflow to the right for mobile apps view!"):
              the 7-column hour grid is a DESKTOP layout — 640px min width
              can only overflow a 390px phone. Phones now get the day list
              below instead; the grid renders from md: up only. */}
          <div className={`mt-2 overflow-x-auto ${view === "timeline" ? "hidden md:block" : "hidden"}`}>
            <div className="min-w-[640px]">
              {/* day headers */}
              <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
                <span />
                {data.days.map((d, i) => (
                  <span key={d} className={`px-1 pb-1 text-center text-[11px] font-semibold ${d === todayS ? "text-gold-deep" : holidayAt(d) ? "text-danger" : "text-muted-foreground"}`}
                    title={holidayAt(d) ? holidayLabel(holidayAt(d)!) : undefined}>
                    {DAYS[i]} <span className="tabular-nums">{d.slice(8)}</span>
                    {holidayAt(d) && <span className="text-danger block truncate text-[9px] font-medium">{holidayAt(d)!.name}</span>}
                  </span>
                ))}
              </div>
              {/* time grid */}
              <div className="border-border relative grid rounded-lg border" style={{ gridTemplateColumns: "48px repeat(7, 1fr)", height: gridHeight }}>
                {/* hour lines + labels */}
                {Array.from({ length: DAY_END - DAY_START }, (_, h) => (
                  <span key={h} className="text-muted-foreground absolute left-1 text-[10px] tabular-nums" style={{ top: h * HOUR_PX - 6 }}>
                    {h === 0 ? "" : `${String(DAY_START + h).padStart(2, "0")}:00`}
                  </span>
                ))}
                {Array.from({ length: DAY_END - DAY_START - 1 }, (_, h) => (
                  <span key={`l${h}`} className="bg-border/60 absolute inset-x-0" style={{ top: (h + 1) * HOUR_PX, height: 1 }} />
                ))}
                {/* day columns */}
                {data.days.map((d, di) => (
                  <div key={d} className={`relative border-l border-border/60 ${d === todayS ? "bg-gold-soft/20" : holidayAt(d) ? "bg-danger-soft/20" : ""} ${drag ? "outline-dashed outline-1 outline-gold/60" : ""}`}
                    style={{ gridColumn: di + 2, gridRow: 1 }}
                    onDragOver={(e) => { if (drag) { e.preventDefault(); } }}
                    onDrop={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      const sess = data.sessions.find((x) => x.id === drag.id);
                      if (!sess) { setDrag(null); return; }
                      /* v1.131.0 — the drag is the fourth way to choose a day
                         for somebody, and the one where the day arrives by
                         accident. Refused here rather than in the confirm bar:
                         a bar that appears only to say no is a bar that wasted
                         the gesture. */
                      const rect = (e.currentTarget as unknown as { getBoundingClientRect(): { top: number } }).getBoundingClientRect();
                      // review fix: subtract the grab offset so the block's TOP
                      // edge (not the cursor) decides the new slot.
                      const y = (e as unknown as { clientY: number }).clientY - rect.top - drag.grabOffsetY;
                      // snap to 30-minute slots inside the visible window
                      const slot = Math.round(((y / HOUR_PX) * 60 + DAY_START * 60) / 30) * 30;
                      const startM = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60 + 30, slot));
                      const durM = (sess.end_time ? mins(sess.end_time) : mins(sess.start_time) + 60) - mins(sess.start_time);
                      if (onLeaveAt(sess.host_user_id, d, toHHMM(startM), durM > 0 ? toHHMM(startM + durM) : null)) {
                        setDrag(null);
                        showToast(L("Not available", "Tidak tersedia"), L("That time overlaps approved leave.", "Masa tersebut bertindih dengan cuti diluluskan."), "notice");
                        return;
                      }
                      setPendingMove({
                        s: sess, date: d,
                        start: toHHMM(startM),
                        // overnight sessions (end < start) keep their end time
                        // untouched instead of collapsing to 30 minutes.
                        end: sess.end_time && durM > 0 ? toHHMM(startM + Math.max(30, durM)) : null,
                      });
                      setDrag(null);
                    }}>
                    {active.filter((s) => s.session_date === d).map((s) => {
                      const top = Math.min(gridHeight - 22, Math.max(0, ((mins(s.start_time) - DAY_START * 60) / 60) * HOUR_PX));
                      // v1.22.8: overnight end (00:00 etc.) counts as next-day,
                      // so the block flows to the bottom edge instead of a sliver.
                      const endM = s.end_time ? mins(s.start_time) + spanMins(s.start_time, s.end_time) : mins(s.start_time) + 60;
                      // clamp inside the 08:00–23:00 window so early/late
                      // sessions pin to the edge instead of overflowing
                      const height = Math.min(gridHeight - top, Math.max(22, ((endM - mins(s.start_time)) / 60) * HOUR_PX - 2));
                      const conflict = conflictIds.has(s.id);
                      const isDragging = drag?.id === s.id;
                      return (
                        <button key={s.id} type="button" onClick={() => { if (!drag) setOpenSession(openSession === s.id ? null : s.id); }}
                          title={`${s.client ?? "Live"} · ${s.start_time}${s.end_time ? `–${s.end_time}` : ""} · ${s.host_name}${canManage ? L(" — drag to reschedule (desktop)", " — seret untuk jadual semula (desktop)") : ""}`}
                          draggable={canManage && s.status === "scheduled"}
                          onDragStart={(e) => {
                            const ev = e as unknown as { clientY: number; currentTarget: { getBoundingClientRect(): { top: number } }; dataTransfer: { effectAllowed: string; setData(t: string, v: string): void } };
                            // review fix: remember WHERE on the block it was grabbed,
                            // so the drop keeps the block's top edge, not the cursor.
                            setDrag({ id: s.id, grabOffsetY: ev.clientY - ev.currentTarget.getBoundingClientRect().top });
                            try {
                              ev.dataTransfer.setData("text/plain", String(s.id)); // Firefox requires setData or the drag cancels
                              ev.dataTransfer.effectAllowed = "move";
                            } catch { /* ok */ }
                          }}
                          onDragEnd={() => setDrag(null)}
                          className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition-opacity hover:opacity-90 ${
                            conflict ? "border-warning bg-warning-soft" : s.status === "completed" ? "border-success bg-success-soft" : "border-brand/30 bg-brand/10"
                          } ${isDragging ? "opacity-40" : ""} ${canManage && s.status === "scheduled" ? "cursor-grab active:cursor-grabbing" : ""}`}
                          style={{ top, height }}>
                          <span className="block truncate font-semibold">{conflict ? <AppIcon name="warning" className="mr-1 -mt-0.5 h-3 w-3" /> : null}{s.client ?? "Live"}</span>
                          <span className="text-muted-foreground block truncate tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {s.host_name.split(" ")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* v1.21.2 — in-grid session popover (was a panel below the
                    board; the CEO had to scroll to find it). */}
                {sel && selDi >= 0 && (
                  <div
                    className="bg-brand absolute z-20 w-64 max-w-[70%] rounded-xl p-3.5 text-white shadow-xl"
                    style={{ top: selTop, ...selPos }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{sel.client ?? L("Live session", "Sesi LIVE")}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${sel.status === "completed" ? "bg-bull/30" : sel.status === "cancelled" ? "bg-bear/30" : "bg-white/15"}`}>{statusLabel(sel.status)}</span>
                      </p>
                      <button type="button" className={iconBtnInverse} onClick={() => setOpenSession(null)} aria-label="Close">✕</button>
                    </div>
                    <p className="mt-1.5 text-xs text-white/85">{sel.host_name}</p>
                    <p className="mt-0.5 text-xs text-white/85 tabular-nums">{dmy(sel.session_date)} · {sel.start_time}{sel.end_time ? `–${sel.end_time}` : ""} · {sel.platform}</p>
                    {sel.notes && <p className="mt-1 text-xs text-white/70">{sel.notes}</p>}
                    {canManage && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canEdit && sel.status !== "cancelled" && (
                          <button type="button" className={btnSmInverse}
                            onClick={() => openEdit(sel)}>
                            {L("Edit details", "Sunting butiran")}
                          </button>
                        )}
                        {sel.status === "scheduled" && (
                          <button type="button" className={btnSmInverse}
                            onClick={() => void setSessionStatus(sel, "completed")}>
                            {L("✓ Mark completed", "✓ Tanda selesai")}
                          </button>
                        )}
                        {sel.status !== "cancelled" && (
                          <button type="button" className={btnSmInverse}
                            onClick={() => void setSessionStatus(sel, "cancelled")}>
                            {L("✕ Cancel session", "✕ Batalkan sesi")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* v1.21.9 — MOBILE agenda (CEO: "find suitable table roaster
              schedule for mobile apps view which is looks nice and never
              overflows"). Structural no-overflow rules: the list clips
              itself (overflow-hidden on the rounded frame), NO negative
              margins anywhere (v1.21.8's today band used -mx-2 — 16px wider
              than the phone, the exact overflow he screenshotted), every
              text span truncates, the time column is fixed-width. */}
          <div className="border-border mt-2 overflow-hidden rounded-xl border md:hidden">
            {data.days.map((d, i) => {
              const dayS = active
                .filter((s) => s.session_date === d)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
              /* v1.66.0 — the phone gets the whole week too. Without this the
                 mobile agenda would quietly show half the day's work, which
                 is worse than showing none of it. */
              const dayB = blocks
                .filter((b) => b.block_date === d)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
              const isToday = d === todayS;
              const hol = holidayAt(d);
              return (
                <div key={d} className={`border-border border-b px-3 py-2 last:border-b-0 ${isToday ? "bg-gold-soft/25" : hol ? "bg-danger-soft/20" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[11px] font-semibold tracking-wide ${isToday ? "text-gold-deep" : hol ? "text-danger" : "text-muted-foreground"}`}>
                      {DAYS[i]} <span className="tabular-nums">{dmy(d)}</span>
                      {isToday && <span className="bg-gold-solid ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white">{L("TODAY", "HARI INI")}</span>}
                      {hol && <span className="bg-danger-soft text-danger ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold">{hol.name}</span>}
                    </p>
                    {dayS.length + dayB.length + shifts.filter((x) => x.shift_date === d).length + events.filter((e) => e.event_date === d).length > 0 && (
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {[
                          events.filter((e) => e.event_date === d).length > 0 ? `${events.filter((e) => e.event_date === d).length} ${L("events", "acara")}` : "",
                          dayS.length > 0 ? (lang === "ms" ? `${dayS.length} sesi` : `${dayS.length} live`) : "",
                          dayB.length > 0 ? `${dayB.length} ${L("tasks", "tugasan")}` : "",
                          shifts.filter((x) => x.shift_date === d).length > 0 ? `${shifts.filter((x) => x.shift_date === d).length} ${L("sales", "jualan")}` : "",
                        ].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {dayS.length + dayB.length + shifts.filter((x) => x.shift_date === d).length + events.filter((e) => e.event_date === d).length === 0 ? (
                    <p className="text-muted-foreground/60 mt-0.5 text-[11px]">—</p>
                  ) : dayS.map((s) => {
                    const isOpen = openSession === s.id;
                    const conflict = conflictIds.has(s.id);
                    const accent = conflict ? "border-l-warning" : s.status === "completed" ? "border-l-success" : s.status === "cancelled" ? "border-l-danger" : "border-l-gold-solid";
                    return (
                      <div key={s.id} className={`bg-secondary/60 mt-1.5 overflow-hidden rounded-lg border-l-4 ${accent}`}>
                        <button type="button" className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left" aria-expanded={isOpen}
                          onClick={() => setOpenSession(isOpen ? null : s.id)}>
                          <span className="w-[52px] shrink-0 text-center">
                            <span className="block text-sm leading-tight font-bold tabular-nums">{s.start_time}</span>
                            {s.end_time && <span className="text-muted-foreground block text-[10px] leading-tight tabular-nums">–{s.end_time}</span>}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{s.client ?? "Live"}</span>
                            <span className="text-muted-foreground block truncate text-xs">{s.host_name.split(" ").slice(0, 2).join(" ")} · {s.platform}</span>
                          </span>
                          <span aria-hidden className="text-muted-foreground shrink-0 text-[10px]">{isOpen ? "▲" : "▼"}</span>
                        </button>
                        {isOpen && (
                          <div className="border-border/60 border-t px-2.5 py-2">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.status === "completed" ? "bg-success-soft text-success" : s.status === "cancelled" ? "bg-danger-soft text-danger" : "bg-secondary"}`}>{statusLabel(s.status)}</span>
                              <span className="text-muted-foreground truncate">{s.host_name}</span>
                            </p>
                            {s.notes && <p className="text-muted-foreground mt-1 text-xs break-words">{s.notes}</p>}
                            {canManage && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {canEdit && s.status !== "cancelled" && (
                                  <button type="button" className={btnSm} onClick={() => openEdit(s)}>
                                    {L("Edit details", "Sunting butiran")}
                                  </button>
                                )}
                                {s.status === "scheduled" && (
                                  <button type="button" className={btnSm}
                                    onClick={() => void setSessionStatus(s, "completed")}>
                                    {L("✓ Mark completed", "✓ Tanda selesai")}
                                  </button>
                                )}
                                {s.status !== "cancelled" && (
                                  <button type="button" className={btnSm}
                                    onClick={() => void setSessionStatus(s, "cancelled")}>
                                    {L("✕ Cancel session", "✕ Batalkan sesi")}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* v1.171.0 - the day's EVENTS. First in the day, because a
                      training everybody has to attend is what the rest of the
                      day is planned around. Whole-floor events say "everyone";
                      an assigned one names its people. */}
                  {events.filter((e) => e.event_date === d).map((e) => (
                    <div key={`me${e.id}`} title={evTitle(e)}
                      className="border-gold bg-gold-soft/60 mt-1 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left">
                      <span className="text-gold-deep w-20 shrink-0 text-[11px] font-semibold tabular-nums">{evTime(e)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          <AppIcon name="date" className="mr-1 -mt-0.5 h-3 w-3" />{e.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {e.attendees.length === 0
                            ? L("everyone", "semua")
                            : e.attendees.map((id) => (staff.find((u) => u.id === id)?.name ?? "").split(" ").slice(0, 2).join(" ")).filter(Boolean).join(", ")}
                          {e.location ? ` · ${e.location}` : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                  {/* v1.66.0 — the day's task blocks, under its live
                      sessions, in the same order the desktop grid uses. */}
                  {dayB.map((b) => (
                    <button key={`mt${b.id}`} type="button"
                      onClick={() => setOpenBlock(openBlock === b.id ? null : b.id)}
                      className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${b.done_at ? "border-success bg-success-soft opacity-70" : hardBlockIds.has(b.id) ? "border-danger bg-danger-soft" : softBlockIds.has(b.id) ? "border-warning bg-warning-soft" : "border-plan bg-plan-soft"}`}>
                      <span className="w-20 shrink-0 text-[11px] font-semibold tabular-nums">
                        {b.start_time}{b.end_time ? `–${b.end_time}` : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-medium ${b.done_at ? "line-through" : ""}`}>
                          {b.done_at ? "✓ " : b.priority === "urgent" ? "❗ " : ""}{b.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {b.user_name.split(" ").slice(0, 2).join(" ")} · {L("task", "tugasan")}
                        </span>
                      </span>
                    </button>
                  ))}
                  {/* v1.158.4 - who has a rest day, in one line, so a phone
                      reader sees the off days without a grid. */}
                  {(() => {
                    const off = (data.rest_days ?? []).filter((r) => r.date === d && !onLeaveAt(r.user_id, d) && !bookedAt(r.user_id, d));
                    if (off.length === 0) return null;
                    const names = off.map((r) => (staff.find((u) => u.id === r.user_id)?.name ?? "").split(" ").slice(0, 2).join(" ")).filter(Boolean);
                    if (names.length === 0) return null;
                    return (
                      <p className="text-muted-foreground mt-1 text-[10px]">
                        <span className="font-semibold">{L("Off day", "Hari cuti")}:</span> {names.join(", ")}
                      </p>
                    );
                  })()}
                  {/* v1.158.0 - the day's sales duty, under its tasks. */}
                  {shifts.filter((x) => x.shift_date === d).map((sh) => (
                    <button key={`ms${sh.id}`} type="button"
                      onClick={() => { setOpenBlock(null); setOpenShift(openShift === sh.id ? null : sh.id); }}
                      className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${shiftCls(sh)}`}>
                      <span className="w-20 shrink-0 text-[11px] font-semibold tabular-nums">{sh.start_time}–{sh.end_time}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {sh.shift_date < todayS && sh.evidence === 0 ? <AppIcon name="warning" className="mr-1 -mt-0.5 h-3 w-3" /> : null}{L("Sales duty", "Tugas jualan")}{sh.target_cents != null ? ` · ${fmtRM(sh.target_cents)}` : ""}
                        </span>
                        <span className="text-muted-foreground block truncate text-[10px]">
                          {sh.user_name.split(" ").slice(0, 2).join(" ")}{sh.shift_date <= todayS ? ` · ${sh.evidence} ${L("logged", "direkod")}` : ""}{sh.focus ? ` · ${sh.focus}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {/* v1.158.0 - a tapped sales duty on the phone agenda (the grid has
              its own note above; this bar is for where there is no chip). */}
          {(() => {
            const sh = shifts.find((x) => x.id === openShift);
            if (!sh || noteAt) return null;
            const past = sh.shift_date <= todayS;
            return (
              <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${shiftCls(sh)}`}>
                <span className="min-w-0">
                  <span className="font-semibold">{L("Sales duty", "Tugas jualan")}</span>
                  <span className="text-muted-foreground">
                    {" · "}{sh.user_name}
                    {" · "}<span className="tabular-nums">{dmy(sh.shift_date)} {sh.start_time}–{sh.end_time}</span>
                    {sh.target_cents != null ? ` · ${L("target", "sasaran")} ${fmtRM(sh.target_cents)}` : ""}
                    {sh.focus ? ` · ${sh.focus}` : ""}
                  </span>
                  {past && (
                    <span className={`block text-xs font-medium ${sh.evidence === 0 ? "text-warning" : "text-success"}`}>
                      {sh.evidence === 0
                        ? L("Nothing was logged on the Sales Performance register that day.", "Tiada apa direkod dalam daftar Prestasi Jualan pada hari itu.")
                        : L(`${sh.evidence} activities on the Sales Performance register that day.`, `${sh.evidence} aktiviti dalam daftar Prestasi Jualan pada hari itu.`)}
                    </span>
                  )}
                </span>
                {(canManage || onOpenRegister) && (
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {onOpenRegister && <button type="button" className={btnSm} onClick={() => onOpenRegister(sh.user_id, sh.shift_date)}>{L("Open the register", "Buka daftar")}</button>}
                    {canManage && <button type="button" className={btnSm} onClick={() => openEditShift(sh)}>{L("Edit", "Sunting")}</button>}
                    {canManage && <button type="button" className={btnSm} onClick={() => void removeShift(sh)}>{L("✕ Remove", "✕ Buang")}</button>}
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setOpenShift(null)}>{L("Close", "Tutup")}</button>
                  </span>
                )}
              </div>
            );
          })()}

          {/* v1.66.0 — a tapped task block. A bar, not a popover: the block
              carries less to say than a live session (the task's own page is
              where its scope and comments live), and this one has to work
              identically on the mobile agenda below. */}
          {(() => {
            const b = blocks.find((x) => x.id === openBlock);
            /* v1.142.0 - when the grid opened it, the note above IS the answer;
               a second copy under the board is the thing the CEO was scrolling
               to find in the first place. */
            if (!b || noteAt) return null;
            const hard = hardBlockIds.has(b.id);
            const soft = softBlockIds.has(b.id);
            return (
              <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${b.done_at ? "border-success bg-success-soft" : hard ? "border-danger bg-danger-soft" : soft ? "border-warning bg-warning-soft" : "border-plan bg-plan-soft"}`}>
                <span className="min-w-0">
                  <span className="font-semibold">{b.title}</span>
                  <span className="text-muted-foreground">
                    {/* The detail bar has the width for the whole name; the
                        chips and the narrow rails keep the short form. */}
                    {" · "}{b.user_name}
                    {" · "}<span className="tabular-nums">{dmy(b.block_date)} {b.start_time}{b.end_time ? `–${b.end_time}` : ""}</span>
                    {b.deadline ? ` · ${L("due", "tarikh akhir")} ${dmy(b.deadline)}` : ""}
                    {(() => {
                      /* How the run is going, counted from what is on the
                         board rather than asked for separately. Only shown
                         when there IS a run — "1 of 1 day" is noise. */
                      const run = blocks.filter((x) => x.task_id === b.task_id);
                      if (run.length < 2) return "";
                      const doneN = run.filter((x) => x.done_at).length;
                      return ` · ${doneN}/${run.length} ${L("days done", "hari selesai")}`;
                    })()}
                  </span>
                  {hard && (
                    <span className="text-danger block text-xs font-medium">
                      {b.deadline && b.block_date > b.deadline
                        ? L("This is scheduled AFTER its own deadline.", "Ini dijadualkan SELEPAS tarikh akhirnya sendiri.")
                        : L("This clashes with approved leave or another task.", "Ini bertindih dengan cuti diluluskan atau tugasan lain.")}
                    </span>
                  )}
                  {soft && (
                    <span className="text-warning block text-xs font-medium">
                      {L("Overlaps a live session — the live is fixed, so move the task.", "Bertindih dengan sesi LIVE — LIVE tetap, jadi alihkan tugasan.")}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* v1.67.0 — the daily tick. This records THE DAY, not the
                      task: a standing duty is finished on Wednesday and open
                      again on Thursday, and one status on the task can never
                      say that. */}
                  <button type="button" className={btnSm}
                    onClick={() => void setBlockDone(b, !b.done_at)}>
                    {b.done_at ? L("↺ Not done after all", "↺ Belum selesai") : L("✓ Done today", "✓ Selesai hari ini")}
                  </button>
                  <button type="button" className={btnSm} onClick={() => openEditBlock(b)}>
                    {L("Edit", "Sunting")}
                  </button>
                  <button type="button" className="text-muted-foreground text-xs underline"
                    onClick={() => void unscheduleBlock(b)}>
                    {L("Unschedule", "Nyahjadual")}
                  </button>
                  {/* v1.171.0 (CEO: "the Task should be able to delete!") -
                      Unschedule takes it off the day; this ends the task. */}
                  {canDeleteTask && (
                    <button type="button" className="text-danger text-xs underline"
                      onClick={() => void deleteTask(b.task_id, b.title, blocks.filter((x) => x.task_id === b.task_id).length)}>
                      {L("Delete task", "Padam tugasan")}
                    </button>
                  )}
                  <button type="button" className="text-muted-foreground text-xs underline"
                    onClick={() => setOpenBlock(null)}>{L("Close", "Tutup")}</button>
                </span>
              </div>
            );
          })()}

          {/* v1.9.0 drag-to-reschedule confirm bar */}
          {pendingMove && (
            <div className="border-gold bg-gold-soft/60 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <span>
                {L("Move", "Pindah")} <span className="font-semibold">{pendingMove.s.client ?? "Live"}</span> ({pendingMove.s.host_name.split(" ")[0]}) →{" "}
                <span className="font-semibold tabular-nums">{dmy(pendingMove.date)} · {pendingMove.start}{pendingMove.end ? `–${pendingMove.end}` : ""}</span>?
              </span>
              <span className="flex gap-2">
                <button type="button" className={btnSm} disabled={saving} onClick={async () => {
                  setSaving(true);
                  const r = await api<{ error?: { message?: string } }>(`/live-sessions/${pendingMove.s.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ session_date: pendingMove.date, start_time: pendingMove.start, ...(pendingMove.end ? { end_time: pendingMove.end } : {}) }),
                  });
                  setSaving(false);
                  if (!r.ok) { showToast(L("No change", "Tiada perubahan"), r.data?.error?.message ?? L("Could not reschedule", "Tidak dapat dijadualkan semula"), "notice"); return; }
                  showToast(L("Rescheduled", "Dijadualkan semula"), `${pendingMove.s.client ?? "Live"} → ${dmy(pendingMove.date)} ${pendingMove.start}`);
                  setPendingMove(null);
                  void load(week);
                }}>{saving ? L("Moving…", "Memindahkan…") : L("✓ Confirm move", "✓ Sahkan pindah")}</button>
                <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setPendingMove(null)}>{L("Cancel", "Batal")}</button>
              </span>
            </div>
          )}

          {/* detail popover (tap a block) */}
          {/* v1.21.2: the session detail moved INTO the grid as a popover
              beside the clicked block (CEO: "it should appear inside the
              calendar" — the panel down here forced a scroll to find it). */}
        </div>

        {/* right rail */}
        {(data.manager || unsched.length > 0) && (
          <div className="space-y-3">
            {/* v1.66.0 — Unscheduled work.
                Open tasks with no block anywhere this week, due this week or
                already late. Deliberately NOT manager-gated: a staff member
                planning their own week is exactly who this rail is for, and
                they see only their own. Tap one, then tap a day. */}
            {unsched.length > 0 && (
              <div className={`rounded-lg border p-3 ${armed ? "border-gold bg-gold-soft/30" : "border-border"}`}>
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  {L("Unscheduled work", "Kerja belum dijadualkan")}
                  <span className="bg-bear ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">{unsched.length}</span>
                </p>
                {armed ? (
                  <p className="text-gold-deep mt-1.5 text-xs font-medium">
                    {L(`Now tap a day for “${armed.title}”.`, `Sekarang tekan hari untuk “${armed.title}”.`)}{" "}
                    <button type="button" className="underline" onClick={() => setArmed(null)}>{L("cancel", "batal")}</button>
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {L("Tap a task, then tap the day it should happen.", "Tekan tugasan, kemudian tekan hari ia patut berlaku.")}
                  </p>
                )}
                {unsched.map((t) => {
                  const late = t.deadline != null && t.deadline < todayS;
                  /* v1.91.0 (CEO: "for Unscheduled work I can clickable on it
                     and update the task accordingly") — two doors on one
                     card. The card itself still arms placement (tap, then a
                     day); the pencil opens the task where it stands, on the
                     same PATCH /tasks/:id the Tasks tab uses, so there is one
                     way to change a task and two places to reach it. */
                  return (
                    <div key={t.id} className={`mt-1.5 rounded-lg border text-xs transition-colors ${armed?.id === t.id ? "border-gold bg-gold-soft" : editTask?.id === t.id ? "border-primary" : "border-border"}`}>
                      <div className="flex items-start">
                        <button type="button" disabled={placing}
                          onClick={() => { setEditTask(null); setArmed(armed?.id === t.id ? null : t); }}
                          className="hover:bg-secondary min-w-0 flex-1 rounded-l-lg px-2.5 py-1.5 text-left"
                          title={L("Tap, then tap the day it should happen", "Tekan, kemudian tekan hari ia patut berlaku")}>
                          <span className="block truncate font-medium">
                            {t.priority === "urgent" ? "❗ " : ""}{t.title}
                          </span>
                          <span className="text-muted-foreground block truncate">
                            {t.assignee.split(" ").slice(0, 2).join(" ")}
                            {t.deadline && (
                              <span className={late ? "text-danger font-semibold" : ""}>
                                {" · "}{late ? L("overdue", "lewat") : L("due", "tarikh akhir")} {dmy(t.deadline)}
                              </span>
                            )}
                          </span>
                        </button>
                        {data.manager && (
                          <button type="button" className="text-muted-foreground hover:text-foreground shrink-0 px-2 py-1.5"
                            aria-expanded={editTask?.id === t.id}
                            title={L("Update the task", "Kemas kini tugasan")}
                            onClick={() => { setArmed(null); setEditTask(editTask?.id === t.id ? null : { id: t.id, title: t.title, assigned_to: String(t.assigned_to), priority: t.priority, deadline: t.deadline ?? "" }); }}>
                            ✎
                          </button>
                        )}
                      </div>
                      {editTask?.id === t.id && (
                        <UnschedEdit draft={editTask} staff={staff} busy={editBusy}
                          onChange={setEditTask}
                          onSave={() => void saveUnsched()}
                          onDone={() => void saveUnsched("completed")}
                          onDelete={canDeleteTask ? () => void deleteTask(t.id, t.title, 0) : undefined}
                          onCancel={() => setEditTask(null)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {data.manager && (
            <div className="border-border rounded-lg border p-3">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                {L("Unassigned requests", "Permintaan belum ditugaskan")} {data.requests.length > 0 && <span className="bg-bear ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">{data.requests.length}</span>}
              </p>
              {data.requests.length === 0
                ? <p className="text-muted-foreground mt-1.5 text-xs">{L("No new requests.", "Tiada permintaan baharu.")}</p>
                : data.requests.map((q) => (
                  <div key={q.id} className="border-border mt-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                    <p className="font-medium">{q.company ?? q.name}</p>
                    <p className="text-muted-foreground">{(q.category ?? "enquiry").replace(/_/g, " ")} · {dmy(q.created_at)}</p>
                    {canManage && (
                      <button type="button" className="text-gold-deep mt-1 text-xs font-medium underline"
                        onClick={() => openAssign({ client_name: q.company ?? q.name })}>
                        {L("Schedule", "Jadualkan")}
                      </button>
                    )}
                  </div>
                ))}
            </div>
            )}
            {data.manager && (
            <div className="border-border rounded-lg border p-3">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{L("Available today", "Tersedia hari ini")}</p>
              {data.available_today.length === 0
                ? <p className="text-muted-foreground mt-1.5 text-xs">{L("Nobody free today.", "Tiada siapa lapang hari ini.")}</p>
                : [...data.available_today].sort(bySeniority).map((a) => (
                  <p key={a.id} className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="bg-bull inline-block h-2 w-2 rounded-full" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="text-muted-foreground shrink-0 capitalize">{a.role.replace(/_/g, " ")}</span>
                  </p>
                ))}
            </div>
            )}
          </div>
        )}
      </div>



      {/* v1.69.0 — edit the work and the day it happens, together.
          Two sections in one dialog rather than two dialogs, because from
          the board they are one question: what is this, and when. Saving
          sends only what actually changed, so an edit to the title cannot
          quietly rewrite a time somebody else adjusted while this was open. */}
      {editBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => setEditBlock(null)}>
          <div className={`${modalCard} max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{L("Update task", "Kemas kini tugasan")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {(() => {
                const run = blocks.filter((x) => x.task_id === editBlock.task_id);
                const doneN = run.filter((x) => x.done_at).length;
                return run.length > 1
                  ? L(`${run.length} days scheduled, ${doneN} done.`, `${run.length} hari dijadualkan, ${doneN} selesai.`)
                  : L("One day scheduled.", "Satu hari dijadualkan.");
              })()}
            </p>

            <p className="text-muted-foreground mt-4 text-[10px] font-semibold tracking-wider uppercase">
              {L("The task", "Tugasan")}
            </p>
            <div className="mt-1.5 space-y-3">
              <div>
                <label className={fieldLabel} htmlFor="ed-title">{L("What needs doing", "Apa yang perlu dibuat")}</label>
                <input id="ed-title" className={inputClass} maxLength={200} value={eDraft.title}
                  onChange={(e) => setEDraft({ ...eDraft, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} htmlFor="ed-prio">{L("Priority", "Keutamaan")}</label>
                  <select id="ed-prio" className={inputClass} value={eDraft.priority}
                    onChange={(e) => setEDraft({ ...eDraft, priority: e.target.value })}>
                    <option value="low">{L("Low", "Rendah")}</option>
                    <option value="normal">{L("Normal", "Biasa")}</option>
                    <option value="high">{L("High", "Tinggi")}</option>
                    <option value="urgent">{L("Urgent", "Segera")}</option>
                  </select>
                </div>
                <div>
                  <label className={fieldLabel} htmlFor="ed-status">{L("Status", "Status")}</label>
                  <select id="ed-status" className={inputClass} value={eDraft.status}
                    onChange={(e) => setEDraft({ ...eDraft, status: e.target.value })}>
                    <option value="open">{L("Open", "Terbuka")}</option>
                    <option value="in_progress">{L("In progress", "Sedang berjalan")}</option>
                    <option value="completed">{L("Completed", "Selesai")}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} htmlFor="ed-due">{L("Due by", "Perlu siap")}</label>
                  <input id="ed-due" type="date" className={inputClass} value={eDraft.deadline}
                    onChange={(e) => setEDraft({ ...eDraft, deadline: e.target.value })} />
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {L("Clear it to remove the due date.", "Kosongkan untuk membuang tarikh akhir.")}
                  </p>
                </div>
                {canManage && (
                  <div>
                    <label className={fieldLabel} htmlFor="ed-who">{L("Who", "Siapa")}</label>
                    <select id="ed-who" className={inputClass} value={eDraft.assigned_to}
                      onChange={(e) => setEDraft({ ...eDraft, assigned_to: e.target.value })}>
                      {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {L("Every scheduled day moves with them.", "Setiap hari yang dijadualkan berpindah bersama.")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className="text-muted-foreground mt-4 text-[10px] font-semibold tracking-wider uppercase">
              {L("This day", "Hari ini")}
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-3">
              <div>
                <label className={fieldLabel} htmlFor="ed-day">{L("Date", "Tarikh")}</label>
                <input id="ed-day" type="date" className={inputClassSm} value={eDraft.block_date}
                  onChange={(e) => setEDraft({ ...eDraft, block_date: e.target.value })} />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="ed-st">{L("From", "Dari")}</label>
                <input id="ed-st" type="time" className={inputClassSm} value={eDraft.start_time}
                  onChange={(e) => setEDraft({ ...eDraft, start_time: e.target.value })} />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="ed-et">{L("To", "Hingga")}</label>
                <input id="ed-et" type="time" className={inputClassSm} value={eDraft.end_time}
                  onChange={(e) => setEDraft({ ...eDraft, end_time: e.target.value })} />
              </div>
            </div>

            {/* Getting the hours wrong on a six-day duty is six corrections
                otherwise, and the sixth is the one that gets forgotten. */}
            {blocks.filter((x) => x.task_id === editBlock.task_id).length > 1 && (
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={eDraft.whole_run}
                  onChange={(e) => setEDraft({ ...eDraft, whole_run: e.target.checked })} />
                <span>
                  {L("Use these hours on every day of this task", "Guna jam ini pada setiap hari tugasan ini")}
                  <span className="text-muted-foreground block text-[11px]">
                    {L("The date above still only moves this one day.", "Tarikh di atas masih hanya mengalihkan hari ini sahaja.")}
                  </span>
                </span>
              </label>
            )}

            {eDraft.deadline && eDraft.block_date > eDraft.deadline && (
              <p className="border-warning bg-warning-soft text-warning mt-3 rounded-lg border px-2.5 py-1.5 text-xs font-medium">
                {L("This day is after the due date.", "Hari ini selepas tarikh akhir.")}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="text-muted-foreground text-sm underline"
                onClick={() => setEditBlock(null)}>{L("Cancel", "Batal")}</button>
              <button type="button" className={btnClass} disabled={savingEdit || !eDraft.title.trim()}
                onClick={async () => {
                  setSavingEdit(true);
                  const b = editBlock;
                  /* Only what changed. Sending the whole form back would let
                     an edit opened five minutes ago overwrite a time somebody
                     else has since fixed. */
                  const taskPatch: Record<string, unknown> = {};
                  if (eDraft.title.trim() !== b.title) taskPatch.title = eDraft.title.trim();
                  if (eDraft.priority !== (b.priority || "normal")) taskPatch.priority = eDraft.priority;
                  if (eDraft.status !== (b.status || "open")) taskPatch.status = eDraft.status;
                  if (eDraft.deadline !== (b.deadline ?? "")) taskPatch.deadline = eDraft.deadline;
                  if (canManage && Number(eDraft.assigned_to) !== b.user_id) taskPatch.assigned_to = Number(eDraft.assigned_to);

                  const blockPatch: Record<string, unknown> = {};
                  if (eDraft.block_date !== b.block_date) blockPatch.block_date = eDraft.block_date;
                  if (eDraft.start_time !== b.start_time) blockPatch.start_time = eDraft.start_time;
                  if (eDraft.end_time !== (b.end_time ?? "")) blockPatch.end_time = eDraft.end_time;
                  if (eDraft.whole_run && (blockPatch.start_time || blockPatch.end_time)) blockPatch.apply_to_run = true;

                  let failed = "";
                  if (Object.keys(taskPatch).length > 0) {
                    const r = await api<{ error?: { message?: string } }>(`/tasks/${b.task_id}`, {
                      method: "PATCH", body: JSON.stringify(taskPatch) });
                    if (!r.ok) failed = r.data?.error?.message ?? L("The task could not be updated", "Tugasan tidak dapat dikemas kini");
                  }
                  if (!failed && Object.keys(blockPatch).length > 0) {
                    const r = await api<{ error?: { message?: string } }>(`/task-blocks/${b.id}`, {
                      method: "PATCH", body: JSON.stringify(blockPatch) });
                    if (!r.ok) failed = r.data?.error?.message ?? L("The day could not be moved", "Hari tidak dapat dialihkan");
                  }
                  setSavingEdit(false);
                  if (failed) { showToast(L("Not saved", "Tidak disimpan"), failed, "notice"); return; }
                  if (Object.keys(taskPatch).length === 0 && Object.keys(blockPatch).length === 0) {
                    showToast(L("Nothing changed", "Tiada perubahan"), eDraft.title.trim(), "notice");
                    setEditBlock(null);
                    return;
                  }
                  showToast(L("Updated", "Dikemas kini"),
                    eDraft.whole_run && blockPatch.apply_to_run
                      ? L(`${eDraft.title.trim()} — hours applied to every day.`,
                          `${eDraft.title.trim()} — jam digunakan pada setiap hari.`)
                      : eDraft.title.trim());
                  setEditBlock(null);
                  void load(week);
                }}>
                {savingEdit ? L("Saving…", "Menyimpan…") : L("Save changes", "Simpan perubahan")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v1.66.0 — assign a task, and give it a slot, in one action.
          Two actions is how a task ends up assigned and never scheduled, and
          an unscheduled task is a wish rather than a plan. The date and time
          are optional: leave them blank and this behaves exactly like the
          Tasks tab, which is the right escape hatch for "do it sometime this
          week". */}
      {taskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => setTaskOpen(false)}>
          <div className={`${modalCard} max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{L("Assign a task", "Tugaskan tugasan")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Give it a day and time and it lands on the board. Leave them blank and it waits in Unscheduled work.",
                 "Beri hari dan masa dan ia akan muncul di papan. Biarkan kosong dan ia menunggu dalam Kerja belum dijadualkan.")}
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className={fieldLabel} htmlFor="tk-title">{L("What needs doing", "Apa yang perlu dibuat")}</label>
                <input id="tk-title" className={inputClass} value={tDraft.title} maxLength={200}
                  placeholder={L("e.g. Photograph the new shawl restock", "cth. Ambil gambar stok shawl baharu")}
                  onChange={(e) => setTDraft({ ...tDraft, title: e.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} htmlFor="tk-who">{L("Who", "Siapa")}</label>
                  <select id="tk-who" className={inputClass} value={tDraft.assigned_to}
                    onChange={(e) => setTDraft({ ...tDraft, assigned_to: e.target.value })}>
                    <option value="">{L("Choose a person…", "Pilih orang…")}</option>
                    {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel} htmlFor="tk-prio">{L("Priority", "Keutamaan")}</label>
                  <select id="tk-prio" className={inputClass} value={tDraft.priority}
                    onChange={(e) => setTDraft({ ...tDraft, priority: e.target.value })}>
                    <option value="low">{L("Low", "Rendah")}</option>
                    <option value="normal">{L("Normal", "Biasa")}</option>
                    <option value="high">{L("High", "Tinggi")}</option>
                    <option value="urgent">{L("Urgent", "Segera")}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={fieldLabel} htmlFor="tk-scope">{L("Scope — one deliverable per line", "Skop — satu penghantaran setiap baris")}</label>
                <textarea id="tk-scope" className={inputClass} rows={3} value={tDraft.items}
                  placeholder={L("Front shots\nBack shots\nUpload to the portal", "Gambar depan\nGambar belakang\nMuat naik ke portal")}
                  onChange={(e) => setTDraft({ ...tDraft, items: e.target.value })} />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {L("Each line becomes a tick-box, so progress is counted rather than guessed.",
                     "Setiap baris menjadi kotak tanda, jadi kemajuan dikira bukan diteka.")}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel} htmlFor="tk-due">{L("Due by", "Perlu siap")}</label>
                  <input id="tk-due" type="date" className={inputClass} value={tDraft.deadline}
                    onChange={(e) => setTDraft({ ...tDraft, deadline: e.target.value })} />
                </div>
                <div>
                  <label className={fieldLabel} htmlFor="tk-day">{L("Work it on", "Buat pada")}</label>
                  <input id="tk-day" type="date" className={inputClass} value={tDraft.block_date}
                    onChange={(e) => setTDraft({ ...tDraft, block_date: e.target.value })} />
                </div>
              </div>

              {tDraft.block_date && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={fieldLabel} htmlFor="tk-st">{L("From", "Dari")}</label>
                    <input id="tk-st" type="time" className={inputClassSm} value={tDraft.start_time}
                      onChange={(e) => setTDraft({ ...tDraft, start_time: e.target.value })} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="tk-et">{L("To", "Hingga")}</label>
                    <input id="tk-et" type="time" className={inputClassSm} value={tDraft.end_time}
                      onChange={(e) => setTDraft({ ...tDraft, end_time: e.target.value })} />
                  </div>
                </div>
              )}

              {/* v1.67.0 — repeat, in the same words the live-session dialog
                  uses. Only offered once a day is chosen: repeating nothing
                  is not a thing to ask about. */}
              {tDraft.block_date && (
                <div className="border-border rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`${fieldLabel} mb-0 mr-1`}>{L("Repeat", "Ulang")}</span>
                    {([["once", L("One-off", "Sekali")], ["daily", L("Every day", "Setiap hari")], ["days", L("Pick days", "Pilih hari")]] as const).map(([v, l]) => (
                      <button key={v} type="button"
                        className={tRepeat === v
                          ? "bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          : "border-border text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"}
                        onClick={() => {
                          setTRepeat(v);
                          if (v !== "once" && !tUntil && tDraft.block_date) {
                            /* A week ahead, because that is the horizon this
                               board shows and the one people mean by "daily". */
                            setTUntil(new Date(new Date(`${tDraft.block_date}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10));
                          }
                        }}>{l}</button>
                    ))}
                    {tRepeat !== "once" && (
                      <label className="ml-auto flex items-center gap-1.5 text-[11px]">
                        <span className="text-muted-foreground">{L("until", "sehingga")}</span>
                        <input type="date" className={`${inputClass} h-7 w-36 text-xs`} value={tUntil}
                          min={tDraft.block_date} onChange={(e) => setTUntil(e.target.value)} />
                      </label>
                    )}
                  </div>
                  {tRepeat === "days" && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {([[L("Mon", "Isn"), 1], [L("Tue", "Sel"), 2], [L("Wed", "Rab"), 3], [L("Thu", "Kha"), 4], [L("Fri", "Jum"), 5], [L("Sat", "Sab"), 6], [L("Sun", "Ahd"), 0]] as const).map(([l, n]) => {
                        const on = tDays.includes(n);
                        return (
                          <button key={n} type="button"
                            className={on
                              ? "bg-gold-solid rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                              : "border-border text-muted-foreground rounded-md border px-2 py-0.5 text-[11px]"}
                            onClick={() => setTDays((ds) => (on ? ds.filter((x) => x !== n) : [...ds, n]))}>{l}</button>
                        );
                      })}
                    </div>
                  )}
                  {/* The DATES it lands on, never the search window. A
                      previous version of the live dialog printed "until the
                      25th" for a rule that stopped on the 19th, and the CEO
                      caught it — same mistake is not worth making twice. */}
                  {tRepeat !== "once" && (() => {
                    const ds = tDates();
                    if (ds.length === 0) {
                      return <p className="text-muted-foreground mt-1.5 text-[11px]">
                        {tRepeat === "days" && tDays.length === 0
                          ? L("Pick at least one weekday.", "Pilih sekurang-kurangnya satu hari.")
                          : L("Choose an until date after the start.", "Pilih tarikh sehingga selepas tarikh mula.")}
                      </p>;
                    }
                    return <p className="text-muted-foreground mt-1.5 text-[11px]">
                      {L(`${ds.length} day${ds.length === 1 ? "" : "s"}: `, `${ds.length} hari: `)}
                      <span className="tabular-nums">{ds.slice(0, 4).map((x) => dmy(x)).join(", ")}</span>
                      {ds.length > 4 ? L(` … to ${dmy(ds[ds.length - 1]!)}`, ` … hingga ${dmy(ds[ds.length - 1]!)}`) : ""}
                    </p>;
                  })()}
                  <p className="text-muted-foreground mt-1.5 text-[11px]">
                    {L("Each day gets its own block you can tick off, so a standing duty shows which days actually happened.",
                       "Setiap hari mendapat bloknya sendiri untuk ditanda, jadi tugas berterusan menunjukkan hari mana yang benar-benar berlaku.")}
                  </p>
                </div>
              )}

              {/* The one mistake this form can catch before the server does,
                  and the one worth catching here because it is a planning
                  error rather than a typo. */}
              {tDraft.block_date && tDraft.deadline && tDraft.block_date > tDraft.deadline && (
                <p className="border-warning bg-warning-soft text-warning rounded-lg border px-2.5 py-1.5 text-xs font-medium">
                  {L("That schedules the work after its own deadline.", "Itu menjadualkan kerja selepas tarikh akhirnya sendiri.")}
                </p>
              )}

              {/* v1.131.0 — the same rule as the live dialog, in the dialog
                  that puts a task on somebody's day. A standing duty that runs
                  through a week of leave keeps the days either side and drops
                  the ones in the middle; a one-off on a leave day has nothing
                  left, and the button says so rather than failing at the
                  server. */}
              {(() => {
                if (!tDraft.assigned_to) return null;
                const away = tDates().filter((d) => onLeaveAt(tDraft.assigned_to, d, tDraft.start_time, tDraft.end_time));
                if (away.length === 0) return null;
                const who = staff.find((u) => String(u.id) === tDraft.assigned_to)?.name.split(" ").slice(0, 2).join(" ") ?? "";
                return (
                  <p className="border-danger bg-danger-soft text-danger rounded-lg border px-2.5 py-1.5 text-xs">
                    <span className="font-semibold">
                      {L(`${who} is on approved leave: `, `${who} bercuti (diluluskan): `)}
                    </span>
                    <span className="tabular-nums">
                      {away.slice(0, 4).map((d) => dmy(d)).join(", ")}
                      {away.length > 4 ? L(` +${away.length - 4} more`, ` +${away.length - 4} lagi`) : ""}
                    </span>
                    <span className="block font-medium">
                      {away.length >= tDates().length
                        ? L("There is no day left to schedule — pick another day, or another person.",
                            "Tiada hari tinggal untuk dijadualkan — pilih hari lain, atau orang lain.")
                        : L("Those days are skipped; the rest of the run still goes ahead.",
                            "Hari tersebut dilangkau; selebihnya ulangan tetap diteruskan.")}
                    </span>
                  </p>
                );
              })()}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="text-muted-foreground text-sm underline"
                onClick={() => setTaskOpen(false)}>{L("Cancel", "Batal")}</button>
              <button type="button" className={btnClass} disabled={savingTask || !tDraft.title.trim() || !tDraft.assigned_to}
                onClick={async () => {
                  const hasSlot = /^\d{4}-\d{2}-\d{2}$/.test(tDraft.block_date);
                  /* v1.131.0 — approved leave days leave the run before it is
                     sent. The server refuses a run containing one AS A WHOLE
                     (half a standing duty landing is worse than none), so
                     filtering here is what lets the usable days through. */
                  const days = hasSlot ? tDates().filter((d) => !onLeaveAt(tDraft.assigned_to, d, tDraft.start_time, tDraft.end_time)) : [];
                  if (hasSlot && days.length === 0) {
                    showToast(L("Not available", "Tidak tersedia"),
                      L("Every day in this run is approved leave for that person. Pick another day, or another person.",
                        "Setiap hari dalam ulangan ini ialah cuti diluluskan bagi orang itu. Pilih hari lain, atau orang lain."),
                      "notice");
                    return;
                  }
                  setSavingTask(true);
                  const r = await api<{ id: number; block_id?: number; days?: number; error?: { message?: string } }>(`/tasks`, {
                    method: "POST",
                    body: JSON.stringify({
                      title: tDraft.title.trim(),
                      assigned_to: Number(tDraft.assigned_to),
                      priority: tDraft.priority,
                      ...(tDraft.deadline ? { deadline: tDraft.deadline } : {}),
                      items: tDraft.items.split("\n").map((x) => x.trim()).filter(Boolean),
                      ...(hasSlot ? { block: { dates: days, block_date: days[0] ?? tDraft.block_date,
                                                start_time: tDraft.start_time, end_time: tDraft.end_time } } : {}),
                    }),
                  });
                  setSavingTask(false);
                  if (!r.ok) {
                    showToast(L("Not assigned", "Tidak ditugaskan"),
                      r.data?.error?.message ?? L("The server refused the task", "Pelayan menolak tugasan"), "notice");
                    return;
                  }
                  const who = staff.find((u) => u.id === Number(tDraft.assigned_to))?.name.split(" ").slice(0, 2).join(" ") ?? "";
                  const madeDays = r.data?.days ?? 0;
                  showToast(L("Assigned", "Ditugaskan"),
                    !hasSlot
                      ? L(`${tDraft.title} — ${who}. It is waiting in Unscheduled work.`,
                          `${tDraft.title} — ${who}. Ia menunggu dalam Kerja belum dijadualkan.`)
                      : madeDays > 1
                        ? L(`${tDraft.title} — ${who}, ${madeDays} days from ${dmy(days[0] ?? tDraft.block_date)}. Tick each day off as it happens.`,
                            `${tDraft.title} — ${who}, ${madeDays} hari dari ${dmy(days[0] ?? tDraft.block_date)}. Tanda setiap hari apabila selesai.`)
                        : `${tDraft.title} — ${who}, ${dmy(days[0] ?? tDraft.block_date)} ${tDraft.start_time}`);
                  setTaskOpen(false);
                  setTDraft({ title: "", assigned_to: "", priority: "normal", deadline: "",
                              block_date: "", start_time: "10:00", end_time: "12:00", items: "" });
                  setTRepeat("once"); setTUntil(""); setTDays([]);
                  void load(week);
                }}>
                {savingTask ? L("Assigning…", "Menugaskan…") : L("Assign", "Tugaskan")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v1.158.0 - SALES DUTY. CEO, 13-09-2026: "beside of Assigned Live, I
          need to assigned them to perform Sales for the Sales person which
          is need to perform based on the day/date that I pick and assigned".
          v1.158.1 (CEO: "card is not standard as it is!" and "sales task
          doesnt appear as Live card which is can pick One-off, Daily or Pick
          days"): the SAME card as the live-session one above - the same
          title, the same two-column field grid, the same field sizes, and the
          Repeat box always in view under the fields, not hidden until a date
          is typed. One card shape for every kind of assignment. */}
      {salesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => { setSalesOpen(false); setEditingShift(null); }}>
          <div className={`${modalCard} max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{editingShift != null ? L("Edit sales duty", "Sunting tugas jualan") : L("New assignment", "Tugasan baharu")} <span className="text-muted-foreground font-normal">· {L("Sales duty", "Tugas jualan")}</span></p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {editingShift != null
                ? L("Amend any detail of this one day — the person, the date, the hours, the target or the focus.", "Pinda mana-mana butiran hari ini — orang, tarikh, waktu, sasaran atau fokus.")
                : L("A sales person, the days you pick, the hours, and a target if you want one. What they actually did that day is read from the Sales Performance register.",
                    "Orang jualan, hari yang anda pilih, waktunya, dan sasaran jika mahu. Apa yang benar-benar dibuat pada hari itu dibaca daripada daftar Prestasi Jualan.")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 block">
                <span className={fieldLabel}>{L("Sales person *", "Orang jualan *")}</span>
                <select className={inputClass} value={sDraft.user_id}
                  onChange={(e) => setSDraft({ ...sDraft, user_id: e.target.value })}>
                  <option value="">{L("— pick —", "— pilih —")}</option>
                  {salesStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Date *", "Tarikh *")}</span>
                <input type="date" className={inputClass} value={sDraft.shift_date}
                  onChange={(e) => setSDraft({ ...sDraft, shift_date: e.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Target (RM)", "Sasaran (RM)")}</span>
                <input type="number" inputMode="decimal" min={0} step="1" className={inputClass} value={sDraft.target}
                  placeholder={L("optional", "pilihan")} onChange={(e) => setSDraft({ ...sDraft, target: e.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Start *", "Mula *")}</span>
                <input type="time" className={inputClass} value={sDraft.start_time}
                  onChange={(e) => setSDraft({ ...sDraft, start_time: e.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("End *", "Tamat *")}</span>
                <input type="time" className={inputClass} value={sDraft.end_time}
                  onChange={(e) => setSDraft({ ...sDraft, end_time: e.target.value })} />
              </label>
              <label className="col-span-2 block">
                <span className={fieldLabel}>{L("Focus", "Fokus")}</span>
                <input className={inputClass} value={sDraft.focus} maxLength={200}
                  placeholder={L("e.g. follow up the hotel leads", "cth. susuli prospek hotel")}
                  onChange={(e) => setSDraft({ ...sDraft, focus: e.target.value })} />
              </label>

              {/* approved leave, named before the press - the live card's box */}
              {(() => {
                if (!sDraft.user_id) return null;
                const away = sDates().filter((d) => onLeaveAt(sDraft.user_id, d, sDraft.start_time, sDraft.end_time));
                if (away.length === 0) return null;
                const who = staff.find((u) => String(u.id) === sDraft.user_id)?.name.split(" ").slice(0, 2).join(" ") ?? "";
                return (
                  <div className="border-danger bg-danger-soft col-span-2 rounded-lg border px-2.5 py-2">
                    <p className="text-danger flex items-center gap-1.5 text-[11px] font-semibold">
                      <AppIcon name="holiday" className="h-3.5 w-3.5" />
                      {L("On approved leave — not available", "Bercuti diluluskan — tidak tersedia")}
                    </p>
                    <ul className="text-danger mt-1 space-y-0.5 text-[11px]">
                      {away.slice(0, 6).map((d) => (
                        <li key={d}><span className="font-medium">{who}</span>{" · "}<span className="tabular-nums">{dmy(d)}</span></li>
                      ))}
                      {away.length > 6 && <li className="opacity-80">{L(`+ ${away.length - 6} more`, `+ ${away.length - 6} lagi`)}</li>}
                    </ul>
                    <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug">
                      {away.length >= sDates().length
                        ? L("There is nothing left to schedule — pick another day, or another person.", "Tiada apa-apa tinggal untuk dijadualkan — pilih hari lain, atau orang lain.")
                        : L("These are skipped — the rest of the run still goes ahead.", "Ini dilangkau — selebihnya ulangan tetap diteruskan.")}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* the repeat rule - the live card's box, always in view.
                Hidden in EDIT mode: an amendment touches exactly one day. */}
            {editingShift == null && (
            <div className="border-border mt-3 rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${fieldLabel} mb-0 mr-1`}>{L("Repeat", "Ulang")}</span>
                {([["once", L("One-off", "Sekali")], ["daily", L("Daily", "Setiap hari")], ["days", L("Pick days", "Pilih hari")]] as const).map(([v, l]) => (
                  <button key={v} type="button"
                    className={sRepeat === v
                      ? "bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      : "border-border text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"}
                    onClick={() => {
                      setSRepeat(v);
                      if (v !== "once" && !sUntil && sDraft.shift_date) {
                        setSUntil(new Date(new Date(`${sDraft.shift_date}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10));
                      }
                    }}>{l}</button>
                ))}
                {sRepeat !== "once" && (
                  <label className="ml-auto flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">{L("until", "sehingga")}</span>
                    <input type="date" className={`${inputClass} h-7 w-36 text-xs`} value={sUntil} min={sDraft.shift_date}
                      onChange={(e) => setSUntil(e.target.value)} />
                  </label>
                )}
              </div>
              {sRepeat === "days" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {([[L("Mon", "Isn"), 1], [L("Tue", "Sel"), 2], [L("Wed", "Rab"), 3], [L("Thu", "Kha"), 4], [L("Fri", "Jum"), 5], [L("Sat", "Sab"), 6], [L("Sun", "Ahd"), 0]] as const).map(([l, n]) => {
                    const on = sDays.includes(n);
                    return (
                      <button key={n} type="button"
                        className={on
                          ? "bg-gold-solid rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                          : "border-border text-muted-foreground rounded-md border px-2 py-0.5 text-[11px]"}
                        onClick={() => setSDays((ds) => (on ? ds.filter((x) => x !== n) : [...ds, n]))}>{l}</button>
                    );
                  })}
                </div>
              )}
              {sRepeat !== "once" && (() => {
                const dts = sDates();
                const wd = (iso: string) => (lang === "ms"
                  ? ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"]
                  : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[new Date(`${iso}T00:00:00Z`).getUTCDay()];
                const dtList = dts.length <= 7
                  ? dts.map((d) => `${wd(d)} ${dmy(d).slice(0, 5)}`).join(", ")
                  : `${wd(dts[0]!)} ${dmy(dts[0]!)} → ${wd(dts[dts.length - 1]!)} ${dmy(dts[dts.length - 1]!)}`;
                const skipped = sDraft.user_id ? dts.filter((d) => onLeaveAt(sDraft.user_id, d, sDraft.start_time, sDraft.end_time)).length : 0;
                return (
                  <p className={`mt-1.5 text-[11px] font-medium ${dts.length > 0 ? "text-success" : "text-warning"}`}>
                    {dts.length > 0 && skipped > 0 && (
                      <span className="text-danger mr-1">{L(`${skipped} skipped for approved leave.`, `${skipped} dilangkau kerana cuti diluluskan.`)}</span>
                    )}
                    {dts.length > 0
                      ? L(`→ Creates ${dts.length} sales day${dts.length === 1 ? "" : "s"}: ${dtList} — nothing outside these dates`,
                          `→ Membuat ${dts.length} hari jualan: ${dtList} — tiada di luar tarikh ini`)
                      : !sDraft.shift_date
                        ? L("Pick the first date above.", "Pilih tarikh pertama di atas.")
                        : sRepeat === "days" && sDays.length === 0
                          ? L("Toggle at least one weekday above.", "Togol sekurang-kurangnya satu hari di atas.")
                          : L("Set the until date — the run needs an end.", "Tetapkan tarikh sehingga — ulangan perlukan penghujung.")}
                  </p>
                );
              })()}
              {/* a public holiday in the run - named, not refused: a sales day
                  on a holiday is the CEO's call, and s.60D pays it */}
              {(() => {
                const hol = sDates().filter((d) => holidayAt(d));
                if (hol.length === 0) return null;
                return (
                  <p className="text-danger mt-1.5 text-[11px]">
                    <span className="font-semibold">{L("Public holiday in this run: ", "Cuti umum dalam ulangan ini: ")}</span>
                    <span className="tabular-nums">{hol.map((d) => `${dmy(d)} ${holidayAt(d)!.name}`).join(", ")}</span>
                    {" — "}{L("it stays in the plan if you schedule it; a holiday worked is paid at the holiday rate.", "ia kekal dalam rancangan jika anda jadualkan; cuti umum yang dikerjakan dibayar pada kadar cuti.")}
                  </p>
                );
              })()}
              <p className="text-muted-foreground mt-1.5 text-[11px]">
                {L("Flow: pick the person, the date and the hours (and a repeat if you want a run) → press Schedule. Each day lands on their row as a SALES chip; once the day has passed it shows what they logged on the Sales Performance register.",
                   "Aliran: pilih orang, tarikh dan waktu (dan ulangan jika mahu satu siri) → tekan Jadualkan. Setiap hari muncul pada baris mereka sebagai cip JUALAN; selepas hari itu berlalu ia menunjukkan apa yang direkod dalam daftar Prestasi Jualan.")}
              </p>
            </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className={btnClass}
                disabled={savingSales || (!!sDraft.user_id && sDates().length > 0 && sDates().every((d) => onLeaveAt(sDraft.user_id, d, sDraft.start_time, sDraft.end_time)))}
                onClick={async () => {
                  if (!sDraft.user_id) { showToast(L("Pick a sales person", "Pilih orang jualan"), L("The sales person is missing.", "Orang jualan belum dipilih."), "notice"); return; }
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(sDraft.shift_date)) { showToast(L("Pick a date", "Pilih tarikh"), L("The date is missing.", "Tarikh belum dipilih."), "notice"); return; }
                  if (!sDraft.end_time || sDraft.end_time <= sDraft.start_time) { showToast(L("Check the hours", "Semak waktu"), L("The end must be after the start.", "Tamat mesti selepas mula."), "notice"); return; }
                  const days = sDates().filter((d) => !onLeaveAt(sDraft.user_id, d, sDraft.start_time, sDraft.end_time));
                  if (days.length === 0) {
                    showToast(L("Nothing to schedule", "Tiada apa untuk dijadualkan"),
                      sRepeat !== "once" && sDates().length === 0
                        ? L("Set the until date, or pick at least one weekday.", "Tetapkan tarikh sehingga, atau pilih sekurang-kurangnya satu hari.")
                        : L("Every day in this run is approved leave for that person. Pick another day, or another person.", "Setiap hari dalam ulangan ini ialah cuti diluluskan bagi orang itu. Pilih hari lain, atau orang lain."),
                      "notice");
                    return;
                  }
                  setSavingSales(true);
                  const target = sDraft.target.trim() === "" ? null : Math.round(Number(sDraft.target) * 100);
                  if (editingShift != null) {
                    const re = await api<{ changed?: string[]; error?: { message?: string } }>(`/sales-shifts/${editingShift}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        user_id: Number(sDraft.user_id), shift_date: sDraft.shift_date,
                        start_time: sDraft.start_time, end_time: sDraft.end_time,
                        target_cents: target, focus: sDraft.focus.trim(),
                      }),
                    });
                    setSavingSales(false);
                    if (!re.ok) {
                      showToast(L("Not saved", "Tidak disimpan"), re.data?.error?.message ?? L("The server refused the change", "Pelayan menolak perubahan"), "notice");
                      return;
                    }
                    const whoE = staff.find((u) => u.id === Number(sDraft.user_id))?.name.split(" ").slice(0, 2).join(" ") ?? "";
                    showToast((re.data?.changed?.length ?? 0) > 0 ? L("Sales duty updated", "Tugas jualan dikemas kini") : L("No changes", "Tiada perubahan"),
                      `${whoE} — ${dmy(sDraft.shift_date)} ${sDraft.start_time}–${sDraft.end_time}`);
                    setSalesOpen(false); setEditingShift(null);
                    setSDraft({ user_id: "", shift_date: todayS, start_time: "10:00", end_time: "18:00", target: "", focus: "" });
                    void load(week);
                    return;
                  }
                  const r = await api<{ days?: number; skipped?: number; error?: { message?: string } }>(`/sales-shifts`, {
                    method: "POST",
                    body: JSON.stringify({
                      user_id: Number(sDraft.user_id), dates: days,
                      start_time: sDraft.start_time, end_time: sDraft.end_time,
                      target_cents: target, focus: sDraft.focus.trim(),
                    }),
                  });
                  setSavingSales(false);
                  if (!r.ok) {
                    showToast(L("Not scheduled", "Tidak dijadualkan"),
                      r.data?.error?.message ?? L("The server refused the assignment", "Pelayan menolak tugasan"), "notice");
                    return;
                  }
                  const who = staff.find((u) => u.id === Number(sDraft.user_id))?.name.split(" ").slice(0, 2).join(" ") ?? "";
                  const made = r.data?.days ?? 0, skipped = r.data?.skipped ?? 0;
                  showToast(L("Sales duty scheduled", "Tugas jualan dijadualkan"),
                    (made > 1
                      ? L(`${who} — ${made} days from ${dmy(days[0]!)}, ${sDraft.start_time}–${sDraft.end_time}.`, `${who} — ${made} hari dari ${dmy(days[0]!)}, ${sDraft.start_time}–${sDraft.end_time}.`)
                      : `${who} — ${dmy(days[0]!)} ${sDraft.start_time}–${sDraft.end_time}`)
                    + (skipped > 0 ? L(` ${skipped} already on the plan.`, ` ${skipped} sudah dalam rancangan.`) : ""));
                  setSalesOpen(false);
                  setSDraft({ user_id: "", shift_date: todayS, start_time: "10:00", end_time: "18:00", target: "", focus: "" });
                  setSRepeat("once"); setSUntil(""); setSDays([]);
                  void load(week);
                }}>
                {savingSales ? (editingShift != null ? L("Saving…", "Menyimpan…") : L("Scheduling…", "Menjadualkan…"))
                  : !!sDraft.user_id && sDates().length > 0 && sDates().every((d) => onLeaveAt(sDraft.user_id, d, sDraft.start_time, sDraft.end_time))
                    ? L("On leave — not available", "Bercuti — tidak tersedia")
                    : editingShift != null ? L("Save changes", "Simpan perubahan") : L("Schedule", "Jadualkan")}
              </button>
              <button type="button" className="text-muted-foreground text-sm underline"
                onClick={() => { setSalesOpen(false); setEditingShift(null); }}>{L("Cancel", "Batal")}</button>
            </div>
          </div>
        </div>
      )}

      {/* assignment modal (click-to-assign) */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onClick={() => setAssignOpen(false)}>
          <div className={`${modalCard} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{editingId != null ? L("Edit session", "Sunting sesi") : L("New assignment", "Tugasan baharu")}</p>
            {editingId != null && (
              <p className="text-muted-foreground mt-0.5 text-xs">{L("Amend any detail — the host is notified if the slot or assignment changes.", "Pinda mana-mana butiran — hos akan dimaklumkan jika slot atau tugasan berubah.")}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 block">
                <span className={fieldLabel}>{L("Client", "Klien")}</span>
                <input className={inputClass} placeholder={L("client / brand", "klien / jenama")} value={draft.client_name}
                  onChange={(e) => setDraft((d) => ({ ...d, client_name: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Date *", "Tarikh *")}</span>
                <input type="date" className={inputClass} value={draft.session_date}
                  onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Host *", "Hos *")}</span>
                <select className={inputClass} value={draft.host_user_id}
                  onChange={(e) => setDraft((d) => ({ ...d, host_user_id: e.target.value }))}>
                  <option value="">{L("— pick —", "— pilih —")}</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>

              {/* v1.29.5 — MULTI-HOST. Styled only with the shared helpers
                  (inputClassSm / chipNeutral / fieldLabel), so it inherits
                  the portal's field sizing, radius and dark mode instead of
                  carrying its own CSS. Create-only: an edit amends one row. */}
              {editingId == null && (
                <div className="col-span-2">
                  {hostIds().length > 1 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {/* every chip is removable, including the one sitting
                          in the main picker: the hosts are equals here (one
                          session each), so a chip you cannot remove would
                          just look broken. Removing the picked one promotes
                          the next in line into the picker. */}
                      {hostIds().map((id) => (
                        <span key={id} className={`${chipNeutral} gap-1`}>
                          {hostShort(id)}
                          <button type="button"
                            aria-label={`${L("Remove", "Buang")} ${hostShort(id)}`}
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => {
                              if (id !== draft.host_user_id) { setExtraHosts((xs) => xs.filter((x) => x !== id)); return; }
                              const [next, ...rest] = extraHosts;
                              setDraft((d) => ({ ...d, host_user_id: next ?? "" }));
                              setExtraHosts(rest);
                            }}>
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <select
                    className={inputClassSm}
                    value=""
                    aria-label={L("Add another host", "Tambah hos lain")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      /* If the main picker is still empty, the first pick
                         belongs THERE — otherwise the form would look
                         hostless while carrying one. */
                      if (!draft.host_user_id) setDraft((d) => ({ ...d, host_user_id: v }));
                      else setExtraHosts((xs) => (xs.includes(v) ? xs : [...xs, v]));
                      e.target.value = "";
                    }}
                  >
                    <option value="">{L("+ Add another host (optional)", "+ Tambah hos lain (pilihan)")}</option>
                    {staff.filter((u) => !hostIds().includes(String(u.id)))
                      .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  {hostIds().length > 1 && (
                    <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                      {lang === "ms"
                        ? `${hostIds().length} hos — setiap seorang dapat sesi sendiri pada slot ini, satu baris setiap orang pada grid, dan dimaklumkan berasingan.`
                        : `${hostIds().length} hosts — each gets their own session for this slot: one row each on the grid, notified separately.`}
                    </p>
                  )}
                </div>
              )}
              {/* v1.131.0 — approved leave, named before the press.
                  CEO, 06-09-2026: "the date that I want to select should not
                  be available to her/him if the date is leave date apply".
                  A native date input cannot grey out one day, so the clash is
                  spelled out here instead — who, and which day — and the run
                  below has already dropped those entries. */}
              {(() => {
                const hits = leaveHits();
                if (hits.length === 0) return null;
                return (
                  <div className="border-danger bg-danger-soft col-span-2 rounded-lg border px-2.5 py-2">
                    <p className="text-danger flex items-center gap-1.5 text-[11px] font-semibold">
                      <AppIcon name="holiday" className="h-3.5 w-3.5" />
                      {/* The heading has to agree with the checkbox under it:
                          "not available" over a ticked override reads as a
                          screen arguing with itself. */}
                      {leaveOverride
                        ? L("On approved leave — booking anyway", "Bercuti diluluskan — tetap ditempah")
                        : L("On approved leave — not available", "Bercuti diluluskan — tidak tersedia")}
                    </p>
                    <ul className="text-danger mt-1 space-y-0.5 text-[11px]">
                      {hits.slice(0, 6).map((h) => (
                        <li key={h.key}>
                          <span className="font-medium">{h.name}</span>
                          {" · "}<span className="tabular-nums">{dmy(h.date)}</span>
                        </li>
                      ))}
                      {hits.length > 6 && (
                        <li className="opacity-80">
                          {L(`+ ${hits.length - 6} more`, `+ ${hits.length - 6} lagi`)}
                        </li>
                      )}
                    </ul>
                    <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug">
                      {/* Three different situations, and saying the wrong one
                          contradicts the button underneath. A one-off on a
                          leave day has no "rest of the run" to go ahead. */}
                      {leaveOverride
                        ? L("Booking anyway. The board will keep flagging these as a clash, and the override is recorded.",
                            "Tetap ditempah. Papan akan terus menanda ini sebagai pertindihan, dan pengecualian ini direkodkan.")
                        : usableCount() === 0
                          ? L("There is nothing left to schedule — pick another day, or another person.",
                              "Tiada apa-apa tinggal untuk dijadualkan — pilih hari lain, atau orang lain.")
                          : L("These are skipped — the rest of the run still goes ahead.",
                              "Ini dilangkau — selebihnya ulangan tetap diteruskan.")}
                    </p>
                    {/* Only the roles that may already amend a session. An
                        approved leave row cannot be un-approved by anybody, so
                        without this the day would be unbookable for ever when
                        somebody does come in. */}
                    {canEdit && (
                      <label className="text-danger mt-1.5 flex items-start gap-1.5 text-[11px]">
                        <input type="checkbox" className="mt-0.5" checked={leaveOverride}
                          onChange={(e) => setLeaveOverride(e.target.checked)} />
                        <span>
                          {L("Book anyway — they have agreed to work these days.",
                             "Tempah juga — mereka bersetuju bekerja pada hari ini.")}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })()}
              <label className="block">
                <span className={fieldLabel}>{L("Start *", "Mula *")}</span>
                <input type="time" className={inputClass} value={draft.start_time}
                  onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("End", "Tamat")}</span>
                <input type="time" className={inputClass} value={draft.end_time}
                  onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>Platform</span>
                <select className={inputClass} value={draft.platform}
                  onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}>
                  <option value="tiktok">TikTok</option><option value="shopee">Shopee</option><option value="other">{L("Other", "Lain-lain")}</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>{L("Notes", "Catatan")}</span>
                <input className={inputClass} value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
              </label>
            </div>

            {/* v1.22.1 — repeat rule: one entry can expand to a whole run.
                Hidden in EDIT mode — an amendment touches exactly one session. */}
            {editingId == null && (
            <div className="border-border mt-3 rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${fieldLabel} mb-0 mr-1`}>{L("Repeat", "Ulang")}</span>
                {([["once", L("One-off", "Sekali")], ["daily", L("Daily", "Setiap hari")], ["days", L("Pick days", "Pilih hari")]] as const).map(([v, l]) => (
                  <button key={v} type="button"
                    className={repeat === v
                      ? "bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                      : "border-border text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"}
                    onClick={() => pickRepeat(v)}>{l}</button>
                ))}
                {repeat !== "once" && (
                  <label className="ml-auto flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">{L("until", "sehingga")}</span>
                    <input type="date" className={`${inputClass} h-7 w-36 text-xs`} value={repeatUntil} min={draft.session_date}
                      onChange={(e) => setRepeatUntil(e.target.value)} />
                  </label>
                )}
              </div>
              {repeat === "days" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {([[L("Mon", "Isn"), 1], [L("Tue", "Sel"), 2], [L("Wed", "Rab"), 3], [L("Thu", "Kha"), 4], [L("Fri", "Jum"), 5], [L("Sat", "Sab"), 6], [L("Sun", "Ahd"), 0]] as const).map(([l, n]) => {
                    const on = repeatDays.includes(n);
                    return (
                      <button key={n} type="button"
                        className={on
                          ? "bg-gold-solid rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                          : "border-border text-muted-foreground rounded-md border px-2 py-0.5 text-[11px]"}
                        onClick={() => setRepeatDays((ds) => (on ? ds.filter((x) => x !== n) : [...ds, n]))}>{l}</button>
                    );
                  })}
                </div>
              )}
              {/* v1.22.6 (CEO: "why it create until 25th if I pick until
                  Friday??!"): the preview used to print the SEARCH WINDOW
                  (start → until) — it read as if sessions ran to the until
                  date. It now prints the ACTUAL dates the rule lands on. */}
              {repeat !== "once" && (() => {
                const dts = expandDates();
                const wd = (iso: string) => (lang === "ms"
                  ? ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"]
                  : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[new Date(`${iso}T00:00:00Z`).getUTCDay()];
                const dtList = dts.length <= 7
                  ? dts.map((d) => `${wd(d)} ${dmy(d).slice(0, 5)}`).join(", ")
                  : `${wd(dts[0]!)} ${dmy(dts[0]!)} → ${wd(dts[dts.length - 1]!)} ${dmy(dts[dts.length - 1]!)}`;
                /* v1.131.0 — how many of those the leave rule takes back out.
                   Said on the same line as the promise, because a run that
                   quietly got shorter otherwise reads as the one asked for. */
                const raw = dts.length * Math.max(1, hostIds().length);
                const skipped = Math.max(0, raw - usableCount());
                return (
                  <p className={`mt-1.5 text-[11px] font-medium ${dts.length > 0 ? "text-success" : "text-warning"}`}>
                    {dts.length > 0 && skipped > 0 && (
                      <span className="text-danger mr-1">
                        {L(`${skipped} skipped for approved leave.`, `${skipped} dilangkau kerana cuti diluluskan.`)}
                      </span>
                    )}
                    {dts.length > 0
                      ? (hostIds().length > 1
                          ? L(`→ Creates ${dts.length} × ${hostIds().length} hosts = ${dts.length * hostIds().length} sessions: ${dtList} — nothing outside these dates`,
                              `→ Membuat ${dts.length} × ${hostIds().length} hos = ${dts.length * hostIds().length} sesi: ${dtList} — tiada di luar tarikh ini`)
                          : L(`→ Creates ${dts.length} session${dts.length === 1 ? "" : "s"}: ${dtList} — nothing outside these dates`,
                              `→ Membuat ${dts.length} sesi: ${dtList} — tiada di luar tarikh ini`))
                      : repeat === "days" && repeatDays.length === 0
                        ? L("Toggle at least one weekday below/above.", "Togol sekurang-kurangnya satu hari di bawah/atas.")
                        : L("Set the until date — the run needs an end.", "Tetapkan tarikh sehingga — ulangan perlukan penghujung.")}
                  </p>
                );
              })()}
              <p className="text-muted-foreground mt-1.5 text-[11px]">
                {L("Flow: set the form (and a repeat if you want a run) → press Schedule. Two or more hosts on the same slot? Add them under Host — each gets their own session. To stack DIFFERENT slots or weeks in one go, press + Add to plan between changes, then Schedule all.",
                   "Aliran: isi borang (dan ulangan jika mahu satu siri) → tekan Jadualkan. Dua hos atau lebih pada slot sama? Tambah di bawah Hos — setiap seorang dapat sesi sendiri. Untuk susun slot atau minggu BERBEZA sekali gus, tekan + Tambah ke pelan antara perubahan, kemudian Jadualkan semua.")}
              </p>
            </div>
            )}

            {/* the plan — everything queued so far */}
            {plan.length > 0 && (
              <div className="border-gold bg-gold-soft/30 mt-2 max-h-40 overflow-y-auto rounded-lg border p-2.5">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{lang === "ms" ? `Pelan · ${plan.length} sesi` : `Plan · ${plan.length} session${plan.length === 1 ? "" : "s"}`}</p>
                {plan.map((e, i) => (
                  <p key={`${e.session_date}${e.start_time}${e.host_user_id}${i}`} className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold tabular-nums">{dmy(e.session_date)} {e.start_time}{e.end_time ? `–${e.end_time}` : ""}</span>
                      <span className="text-muted-foreground"> · {(staff.find((u) => String(u.id) === String(e.host_user_id))?.name ?? "").split(" ").slice(0, 2).join(" ")}{e.client_name ? ` · ${e.client_name}` : ""}</span>
                    </span>
                    <button type="button" aria-label="Remove from plan" className="text-muted-foreground shrink-0 hover:text-danger"
                      onClick={() => setPlan((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </p>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {editingId != null ? (
                <button type="button" className={btnClass} disabled={saving} onClick={() => void saveEdit()}>
                  {saving ? L("Saving…", "Menyimpan…") : L("Save changes", "Simpan perubahan")}
                </button>
              ) : (
                <>
                  {/* v1.131.0 — when the form is COMPLETE and every entry in
                      it is an approved leave day, the button stops being a
                      button. That is the CEO's "should not be available" said
                      as plainly as a screen can say it.
                      Gated on a filled-in form on purpose: an empty one must
                      stay pressable, because its toast is what explains which
                      field is missing, and a silently dead button explains
                      nothing at all. */}
                  <button type="button" className={btnClass}
                    disabled={saving || (plan.length === 0 && hostIds().length > 0
                                         && expandDates().length > 0 && usableCount() === 0)}
                    onClick={() => void saveAssign()}>
                    {saving ? L("Scheduling…", "Menjadualkan…")
                      : plan.length === 0 && hostIds().length > 0 && expandDates().length > 0 && usableCount() === 0
                        ? L("On leave — not available", "Bercuti — tidak tersedia")
                      : plan.length > 0 ? L(`Schedule all (${plan.length})`, `Jadualkan semua (${plan.length})`)
                      /* v1.29.5: the count is dates x hosts, not dates. The
                         button must promise exactly what the press creates —
                         2 hosts on a 5-day run is 10 sessions.
                         v1.131.0: minus the days those hosts are on leave, for
                         the same reason — the promise has to be the outcome. */
                      : usableCount() > 1
                        ? L(`Schedule ${usableCount()} sessions`, `Jadualkan ${usableCount()} sesi`)
                      : L("Schedule", "Jadualkan")}
                  </button>
                  <button type="button" className={btnSm} disabled={saving} onClick={addToPlan}>{L("+ Add to plan", "+ Tambah ke pelan")}</button>
                </>
              )}
              <button type="button" className="text-muted-foreground text-xs underline" onClick={() => { setAssignOpen(false); setEditingId(null); }}>{L("Cancel", "Batal")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
