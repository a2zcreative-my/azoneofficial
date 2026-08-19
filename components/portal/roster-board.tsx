"use client";

/* v1.8.0 — 📆 Schedule & Roster (the reference design's flagship screen, in
   brand colours). Week time-grid of live sessions with conflict flags, a
   detail popover, stat chips, an unassigned-requests rail, "available today",
   and click-to-assign (reuses POST /staff/live-sessions). Managers see the
   whole floor; hosts see their own week read-only. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, inputClass, inputClassSm, btnClass, btnSm, fieldLabel, chipWarn, chipSuccess, chipNeutral } from "@/lib/ui-styles";
import { dmy } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { shareRosterPdf } from "@/lib/roster-pdf";
import { MiniCalendar } from "@/components/portal/mini-calendar";

const api = makeApi("/staff");

interface RosterSession {
  id: number; session_date: string; start_time: string; end_time: string | null;
  platform: string; status: string; client: string | null; notes: string | null;
  host_user_id: number; host_name: string; photo_key: string | null;
}
interface RosterData {
  week_start: string; days: string[]; manager: boolean;
  sessions: RosterSession[];
  on_leave: { user_id: number; name: string; start_date: string; end_date: string }[];
  conflicts: { kind: string; session_ids: number[]; host_user_id: number; date: string }[];
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
export function RosterBoard({ canManage, canEdit = false }: { canManage: boolean; canEdit?: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
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
  const [assignOpen, setAssignOpen] = useState(false);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState({ session_date: "", start_time: "19:00", end_time: "21:00", platform: "tiktok", client_name: "", host_user_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  /* v1.21.0 (CEO: "the data of leave applied date should be shown on the
     pill on leave"): the chip opens who is away and exactly when. */
  const [leaveOpen, setLeaveOpen] = useState(false);
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
  useEffect(() => {
    if (!canManage) return;
    void api<{ staff: { id: number; name: string }[] }>(`/staff-list`).then((r) => { if (r.ok && r.data?.staff) setStaff(r.data.staff); });
  }, [canManage]);

  const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

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
    const all = expandDates().flatMap((dt) =>
      hosts.map((h) => ({ ...draft, session_date: dt, host_user_id: h })),
    );
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
        body: JSON.stringify({ ...e, host_user_id: Number(e.host_user_id) }),
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
    return <div className={card}><p className="text-sm font-semibold">📆 {L("Schedule & Roster", "Jadual & Roster")}</p>
      <p className="text-muted-foreground mt-1 text-xs">The roster needs the latest Worker deploy (and migration 0056).</p></div>;
  }
  if (!data) {
    return <div className={card}><p className="text-sm font-semibold">📆 {L("Schedule & Roster", "Jadual & Roster")}</p>
      {failed
        ? <p className="text-muted-foreground mt-2 text-sm">{L("Could not load the week —", "Minggu tidak dapat dimuatkan —")} <button type="button" className="underline" onClick={() => void load(week)}>{L("try again", "cuba lagi")}</button>.</p>
        : <p className="text-muted-foreground mt-2 text-sm">{L("Loading the week…", "Memuatkan minggu…")}</p>}
    </div>;
  }

  const active = data.sessions.filter((s) => s.status !== "cancelled");
  const conflictIds = new Set(data.conflicts.flatMap((c) => c.session_ids));
  const onLeaveCount = new Set(data.on_leave.map((l) => l.user_id)).size;
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">📆 {L("Schedule & Roster", "Jadual & Roster")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{L("Plan live-host assignments, availability and replacements.", "Rancang tugasan hos live, ketersediaan dan pengganti.")}</p>
        </div>
        {canManage && (
          <button type="button" className={btnClass} onClick={() => openAssign()}>＋ {L("New assignment", "Tugasan baharu")}</button>
        )}
      </div>

      {/* stat chips (reference: Scheduled / Available / On leave / Conflicts) */}
      <div className="mt-3 flex flex-wrap gap-2">
        {chip(L("scheduled", "dijadualkan"), active.length, "bg-secondary")}
        {data.manager && chip(L("available today", "tersedia hari ini"), data.available_today.length, chipSuccess)}
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
                  const how = await shareRosterPdf(
                    data.days, data.sessions, staff, data.on_leave,
                    data.conflicts.flatMap((cf) => cf.session_ids), "AZ ONE staff portal");
                  showToast(how === "shared" ? L("Ready to share", "Sedia untuk dikongsi") : L("Downloaded", "Dimuat turun"),
                    `${L("Week roster PDF", "PDF roster minggu")} · ${dmy(data.days[0]!)} – ${dmy(data.days[6]!)}`);
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
              <div className="border-border relative min-w-[760px] overflow-hidden rounded-lg border">
                {(() => {
                  const durOf = (s: RosterSession) => (s.end_time ? Math.max(30, spanMins(s.start_time, s.end_time)) : 60);
                  const hrs = (m: number) => `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)} ${L("hrs", "jam")}`;
                  const nSess = (n: number) => (lang === "ms" ? `${n} sesi` : `${n} session${n === 1 ? "" : "s"}`);
                  const onLeave = (uid: number, d: string) => data.on_leave.some((l) => l.user_id === uid && l.start_date <= d && d <= l.end_date);
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
                          <p className="text-xs font-semibold text-white tabular-nums">{nSess(active.length)} · {hrs(active.reduce((a, s) => a + durOf(s), 0))}</p>
                        </div>
                        {data.days.map((d, i) => {
                          const dayS = active.filter((s) => s.session_date === d);
                          const isToday = d === todayS;
                          return (
                            <div key={d} className={`border-border min-w-0 border-l px-2 py-2 text-center ${isToday ? "bg-gold-soft/40" : "bg-secondary/50"}`}>
                              <p className={`text-[11px] font-semibold ${isToday ? "text-gold-deep" : ""}`}>{DAYS[i]} <span className="tabular-nums">{d.slice(8)}</span></p>
                              <p className="text-muted-foreground text-[10px] tabular-nums">
                                {dayS.length === 0 ? "—" : `${dayS.length} · ${hrs(dayS.reduce((a, s) => a + durOf(s), 0))}`}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      {/* one row per staff member */}
                      {rows.map((u) => {
                        const mine = active.filter((s) => s.host_user_id === u.id);
                        return (
                          <div key={u.id} className="border-border grid border-b last:border-b-0" style={gridCols}>
                            <div className="border-border flex min-w-0 flex-col justify-center border-r px-3 py-1.5">
                              <p className="truncate text-xs font-semibold" title={u.name}>{u.name.split(" ").slice(0, 2).join(" ")}</p>
                              <p className="text-muted-foreground text-[10px] tabular-nums">
                                {mine.length === 0 ? L("no sessions", "tiada sesi") : `${nSess(mine.length)} · ${hrs(mine.reduce((a, s) => a + durOf(s), 0))}`}
                              </p>
                            </div>
                            {data.days.map((d) => {
                              const cs = cellSessions(u.id, d);
                              const leave = onLeave(u.id, d);
                              return (
                                <div key={d} className={`border-border min-h-12 min-w-0 space-y-1 border-l p-1 ${d === todayS ? "bg-gold-soft/15" : ""}`}>
                                  {leave && (
                                    <div className="bg-danger-soft text-danger rounded-md px-1.5 py-1 text-center text-[10px] font-semibold">{L("On leave", "Bercuti")}</div>
                                  )}
                                  {cs.map((s) => (
                                    <button key={s.id} type="button"
                                      title={`${s.client ?? "Live"} · ${s.start_time}${s.end_time ? `–${s.end_time}` : ""} · ${s.host_name}${s.notes ? ` — ${s.notes}` : ""}`}
                                      onClick={() => setOpenSession(openSession === s.id ? null : s.id)}
                                      className={`block w-full rounded-md border px-1.5 py-1 text-left ${chipCls(s)}`}>
                                      <span className="block truncate text-[10px] leading-tight font-semibold">{s.client ?? "Live"}</span>
                                      <span className="text-muted-foreground block truncate text-[9px] leading-tight tabular-nums">
                                        {s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {durOf(s)} min
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {/* centred detail card for a clicked chip */}
                      {sel && (
                        <div className="bg-brand absolute left-1/2 top-14 z-20 w-72 -translate-x-1/2 rounded-xl p-3.5 text-white shadow-xl">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold">{sel.client ?? L("Live session", "Sesi LIVE")}
                              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${sel.status === "completed" ? "bg-bull/30" : sel.status === "cancelled" ? "bg-bear/30" : "bg-white/15"}`}>{statusLabel(sel.status)}</span>
                            </p>
                            <button type="button" className="text-white/70 hover:text-white" onClick={() => setOpenSession(null)} aria-label="Close">✕</button>
                          </div>
                          <p className="mt-1.5 text-xs text-white/85">{sel.host_name}</p>
                          <p className="mt-0.5 text-xs text-white/85 tabular-nums">{dmy(sel.session_date)} · {sel.start_time}{sel.end_time ? `–${sel.end_time}` : ""} · {sel.platform}</p>
                          {sel.notes && <p className="mt-1 text-xs text-white/70">{sel.notes}</p>}
                          {canManage && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {canEdit && sel.status !== "cancelled" && (
                                <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                                  onClick={() => openEdit(sel)}>
                                  {L("Edit details", "Sunting butiran")}
                                </button>
                              )}
                              {sel.status === "scheduled" && (
                                <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                                  onClick={() => void setSessionStatus(sel, "completed")}>
                                  {L("✓ Mark completed", "✓ Tanda selesai")}
                                </button>
                              )}
                              {sel.status !== "cancelled" && (
                                <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                                  onClick={() => void setSessionStatus(sel, "cancelled")}>
                                  {L("✕ Cancel session", "✕ Batalkan sesi")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {/* legend */}
                      <div className="border-border text-muted-foreground flex flex-wrap gap-3 border-t px-3 py-1.5 text-[10px]">
                        <span className="inline-flex items-center gap-1"><span className="border-brand/30 bg-brand/10 h-2.5 w-2.5 rounded-sm border" />TikTok</span>
                        <span className="inline-flex items-center gap-1"><span className="border-gold bg-gold-soft/60 h-2.5 w-2.5 rounded-sm border" />Shopee</span>
                        <span className="inline-flex items-center gap-1"><span className="border-border bg-secondary h-2.5 w-2.5 rounded-sm border" />{L("Other", "Lain-lain")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-success bg-success-soft h-2.5 w-2.5 rounded-sm border" />{L("Completed", "Selesai")}</span>
                        <span className="inline-flex items-center gap-1"><span className="border-warning bg-warning-soft h-2.5 w-2.5 rounded-sm border" />{L("Conflict", "Pertindihan")}</span>
                        <span className="inline-flex items-center gap-1"><span className="bg-danger-soft h-2.5 w-2.5 rounded-sm" />{L("On leave", "Bercuti")}</span>
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
                  <span key={d} className={`px-1 pb-1 text-center text-[11px] font-semibold ${d === todayS ? "text-gold-deep" : "text-muted-foreground"}`}>
                    {DAYS[i]} <span className="tabular-nums">{d.slice(8)}</span>
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
                  <div key={d} className={`relative border-l border-border/60 ${d === todayS ? "bg-gold-soft/20" : ""} ${drag ? "outline-dashed outline-1 outline-gold/60" : ""}`}
                    style={{ gridColumn: di + 2, gridRow: 1 }}
                    onDragOver={(e) => { if (drag) { e.preventDefault(); } }}
                    onDrop={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      const sess = data.sessions.find((x) => x.id === drag.id);
                      if (!sess) { setDrag(null); return; }
                      const rect = (e.currentTarget as unknown as { getBoundingClientRect(): { top: number } }).getBoundingClientRect();
                      // review fix: subtract the grab offset so the block's TOP
                      // edge (not the cursor) decides the new slot.
                      const y = (e as unknown as { clientY: number }).clientY - rect.top - drag.grabOffsetY;
                      // snap to 30-minute slots inside the visible window
                      const slot = Math.round(((y / HOUR_PX) * 60 + DAY_START * 60) / 30) * 30;
                      const startM = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60 + 30, slot));
                      const durM = (sess.end_time ? mins(sess.end_time) : mins(sess.start_time) + 60) - mins(sess.start_time);
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
                          <span className="block truncate font-semibold">{conflict ? "⚠ " : ""}{s.client ?? "Live"}</span>
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
                      <button type="button" className="text-white/70 hover:text-white" onClick={() => setOpenSession(null)} aria-label="Close">✕</button>
                    </div>
                    <p className="mt-1.5 text-xs text-white/85">{sel.host_name}</p>
                    <p className="mt-0.5 text-xs text-white/85 tabular-nums">{dmy(sel.session_date)} · {sel.start_time}{sel.end_time ? `–${sel.end_time}` : ""} · {sel.platform}</p>
                    {sel.notes && <p className="mt-1 text-xs text-white/70">{sel.notes}</p>}
                    {canManage && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canEdit && sel.status !== "cancelled" && (
                          <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                            onClick={() => openEdit(sel)}>
                            {L("Edit details", "Sunting butiran")}
                          </button>
                        )}
                        {sel.status === "scheduled" && (
                          <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                            onClick={() => void setSessionStatus(sel, "completed")}>
                            {L("✓ Mark completed", "✓ Tanda selesai")}
                          </button>
                        )}
                        {sel.status !== "cancelled" && (
                          <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
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
              const isToday = d === todayS;
              return (
                <div key={d} className={`border-border border-b px-3 py-2 last:border-b-0 ${isToday ? "bg-gold-soft/25" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[11px] font-semibold tracking-wide ${isToday ? "text-gold-deep" : "text-muted-foreground"}`}>
                      {DAYS[i]} <span className="tabular-nums">{dmy(d)}</span>
                      {isToday && <span className="bg-gold-solid ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white">{L("TODAY", "HARI INI")}</span>}
                    </p>
                    {dayS.length > 0 && (
                      <span className="text-muted-foreground text-[10px] tabular-nums">{lang === "ms" ? `${dayS.length} sesi` : `${dayS.length} session${dayS.length === 1 ? "" : "s"}`}</span>
                    )}
                  </div>
                  {dayS.length === 0 ? (
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
                </div>
              );
            })}
          </div>

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
        {data.manager && (
          <div className="space-y-3">
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
            <div className="border-border rounded-lg border p-3">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{L("Available today", "Tersedia hari ini")}</p>
              {data.available_today.length === 0
                ? <p className="text-muted-foreground mt-1.5 text-xs">{L("Nobody free today.", "Tiada siapa lapang hari ini.")}</p>
                : data.available_today.map((a) => (
                  <p key={a.id} className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="bg-bull inline-block h-2 w-2 rounded-full" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="text-muted-foreground shrink-0 capitalize">{a.role.replace(/_/g, " ")}</span>
                  </p>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* assignment modal (click-to-assign) */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onClick={() => setAssignOpen(false)}>
          <div className="bg-card border-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                return (
                  <p className={`mt-1.5 text-[11px] font-medium ${dts.length > 0 ? "text-success" : "text-warning"}`}>
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
                  <button type="button" className={btnClass} disabled={saving} onClick={() => void saveAssign()}>
                    {saving ? L("Scheduling…", "Menjadualkan…")
                      : plan.length > 0 ? L(`Schedule all (${plan.length})`, `Jadualkan semua (${plan.length})`)
                      /* v1.29.5: the count is dates x hosts, not dates. The
                         button must promise exactly what the press creates —
                         2 hosts on a 5-day run is 10 sessions. */
                      : expandDates().length * Math.max(1, hostIds().length) > 1
                        ? (() => { const n = Math.min(MAX_PER_PRESS, expandDates().length * Math.max(1, hostIds().length));
                            return L(`Schedule ${n} sessions`, `Jadualkan ${n} sesi`); })()
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
