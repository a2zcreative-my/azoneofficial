"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { ShieldOk } from "@/components/layout/nav-icons";
import { UpcomingEventsCard } from "@/components/portal/events";
import { LocationHelp } from "@/components/portal/location-help";
import { OneDesk } from "@/components/portal/one-desk";
import { Announcement, DASH_ANNS, DASH_ATT, DASH_LEAVE, DASH_TASKS, DashCache, L, LeaveReq, MONTH_NAMES, MonthDay, SectionTabs, Task, User, ZoneLabel, annCatL, leaveTypeL, mytGreeting, mytTime, mytTodayLine, priorityL } from "@/components/portal/page-shared";
import { SalesDoc } from "@/components/portal/sales";
import { TradingDesk } from "@/components/portal/trading-desk";
import { WATCHER_ROLES, WatchersCard } from "@/components/portal/watchers-card";
import { Skel, SkelRows, SkelText } from "@/components/ui/skeleton";
import { SITE_CONFIG } from "@/constants/site";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { cacheRead, cacheWrite } from "@/lib/cached-api";
import { dmy, fmtRM, mytDateOf, mytToday } from "@/lib/format";
import { Lang, getLang, t as tr } from "@/lib/i18n";

/* ---- v1.175.0 — the dashboard's reading order, per job ----------------
   The five zones never change; which comes first does. Exported so
   tests/one-desk.mjs asserts the ORDER MAP rather than the position of a
   string in this file, and so the phone's bottom bar leans on the same three
   names (lib/portal-tabs.ts) instead of inventing a second idea of who is a
   manager. */
export type DashboardZone = "day" | "desk" | "month" | "company" | "around";
export type DashboardLead = "business" | "sales" | "shift";
export const DASHBOARD_ZONES: Record<DashboardLead, readonly DashboardZone[]> = {
  /* results and decisions first; the person's own day and month stay
     together below them, the clock above the summary of it */
  business: ["company", "desk", "day", "month", "around"],
  /* the follow-ups they are judged on, then the target, then the clock */
  sales: ["desk", "company", "day", "around", "month"],
  /* the clock first — the order every staff member has had since v1.115.0 */
  shift: ["day", "desk", "month", "company", "around"],
};
import { SALES_ROLES, TabName } from "@/lib/portal-tabs";
import { btnHero, btnHeroPrimary, btnSm, card, chipSmNeutral, toastCard } from "@/lib/ui-styles";
import { Fragment, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import css from "./dashboard.module.css";

/**
 * Punch confirmation overlay (v1.4.29): centered card, animated ring +
 * check draw, brand navy, auto-dismisses. Pure CSS keyframes — no library.
 */

/* ═══════════════════════════════════════════════════════════════════════
   v1.170.0 — ATTENDANCE THIS MONTH (the CEO's reference: "Kehadiran Bulan
   Ini" — present, on time, late, streak — on the employee's own home
   screen). Every figure here is a COUNT of verdicts the worker reached with
   the same functions payroll uses (myMonthDays); nothing is computed from
   raw punches on the client, so this card and the HR report can never
   disagree about the same day.
   ═══════════════════════════════════════════════════════════════════════ */
export function summariseMonth(days: MonthDay[]) {
  let onTime = 0, late = 0, halfDay = 0, absent = 0, awaiting = 0, leave = 0, holiday = 0, restWorked = 0, scheduled = 0;
  for (const d of days) {
    if (d.status === "ok" || d.status === "assigned") onTime++;
    else if (d.status === "late") late++;
    else if (d.status === "half_day") halfDay++;
    else if (d.status === "absent") absent++;
    else if (d.status === "awaiting_approval") awaiting++;
    else if (d.status === "leave") leave++;
    else if (d.status === "holiday") holiday++;
    if (d.status === "rest_day" && d.worked) restWorked++;
    /* a scheduled day that is over — today still open does not count yet */
    if (d.scheduled && d.status !== "pending" && d.status !== "leave" && d.status !== "holiday") scheduled++;
  }
  /* the streak: consecutive scheduled days on time, walking back from the
     most recent day that is settled. Off days, leave, holidays and a punch
     still awaiting the CEO neither extend nor break it. Today, if it has no
     verdict yet, is skipped — the streak is what has been PROVEN. */
  let streak = 0;
  for (const d of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
    if (d.status === "ok" || d.status === "assigned") streak++;
    else if (d.status === "late" || d.status === "half_day" || d.status === "absent") break;
  }
  return { onTime, late, halfDay, absent, awaiting, leave, holiday, restWorked, scheduled, streak, present: onTime + late + halfDay + restWorked };
}

/* v1.172.2 - the day cells are module classes (dashboard.module.css); the
   fills are the validated ring colours the attendance donut uses. */
const DAY_FILL: Record<MonthDay["status"], string | undefined> = {
  ok: css.dayOnTime, assigned: css.dayOnTime,
  late: css.dayLate,
  half_day: css.dayAbsent, absent: css.dayAbsent,
  awaiting_approval: css.dayAwaiting,
  pending: css.dayPending,
  rest_day: css.dayOff, holiday: css.dayOff, leave: css.dayLeave,
};
const dayStatusL = (s: MonthDay["status"], lang: Lang): string => {
  const en: Record<MonthDay["status"], string> = {
    ok: "On time", assigned: "Assigned work", late: "Late", half_day: "Half day", absent: "Absent",
    awaiting_approval: "Punch awaiting approval", pending: "Today — no punch yet", rest_day: "Rest day", holiday: "Public holiday", leave: "Leave",
  };
  const ms: Record<MonthDay["status"], string> = {
    ok: "Tepat waktu", assigned: "Kerja ditugaskan", late: "Lewat", half_day: "Separuh hari", absent: "Tidak hadir",
    awaiting_approval: "Punch menunggu kelulusan", pending: "Hari ini — belum punch", rest_day: "Hari rehat", holiday: "Cuti umum", leave: "Cuti",
  };
  return (lang === "ms" ? ms : en)[s];
};

/** The month card. Counts on the left, the month as a small calendar of
    verdicts on the right — one cell per day, Monday first, the same
    validated ring colours the attendance donut uses.
    v1.171.0 — the CEO, 20-09-2026: *"clean off my dashboard and resort it
    based on it own function"*. The month was on the Dashboard three ways
    (the four-tile strip, this card, a bar chart behind a pill). It is ONE
    card now: the punches' own figures (days present, hours - `daysPresent`,
    `hours`) sit beside the verdicts. `days` may be null - an older worker,
    or a classifier that could not run - and the card then shows the
    punch figures alone and says the verdicts are not available, rather
    than guessing. */
export function MonthAttendanceCard({ days, month, lang, daysPresent, hours }: {
  days: MonthDay[] | null; month: string; lang: Lang; daysPresent?: number; hours?: number;
}) {
  const has = !!days && days.length > 0;
  const s = summariseMonth(days ?? []);
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  /* Monday-first offset of the 1st: JS Sunday=0 → 6, Monday=1 → 0 */
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (MonthDay | { date: string; status: "future" })[] = [];
  for (let d = 1; d <= last; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    cells.push(byDate.get(iso) ?? { date: iso, status: "future" });
  }
  const monthName = MONTH_NAMES[lang === "ms" ? "ms" : "en"][m - 1] ?? month;
  const stat = (label: string, value: string | number, tone: string | undefined) => (
    <div className={css.stat}>
      <p className={css.statLabel}>{label}</p>
      <p className={`${css.statValue} ${tone ?? ""}`}>{value}</p>
    </div>
  );
  const notes: string[] = [];
  if (s.absent > 0) notes.push(L(`${s.absent} absent`, `${s.absent} tidak hadir`));
  if (s.awaiting > 0) notes.push(L(`${s.awaiting} awaiting the CEO's approval`, `${s.awaiting} menunggu kelulusan CEO`));
  if (s.leave > 0) notes.push(L(`${s.leave} on leave`, `${s.leave} cuti`));
  if (s.holiday > 0) notes.push(L(`${s.holiday} public holiday${s.holiday === 1 ? "" : "s"}`, `${s.holiday} cuti umum`));
  if (s.restWorked > 0) notes.push(L(`${s.restWorked} rest day${s.restWorked === 1 ? "" : "s"} worked`, `${s.restWorked} hari rehat bekerja`));
  return (
    <div className={card}>
      <div className={css.monthHead}>
        <PanelTitle icon="date">{L("Attendance this month", "Kehadiran bulan ini")}</PanelTitle>
        <p className={css.monthWhen}>
          {has
            ? L(`${s.present} of ${s.scheduled} scheduled days · ${monthName}`, `${s.present} daripada ${s.scheduled} hari berjadual · ${monthName}`)
            : monthName}
        </p>
      </div>
      <div className={css.monthBody}>
        <div className={`${css.stats} ${has ? css.statsFull : ""}`}>
          {has && stat(L("On time", "Tepat waktu"), s.onTime, css.onTime)}
          {has && stat(L("Late", "Lewat"), s.late, s.late > 0 ? css.late : "")}
          {has && stat(L("Half day", "Separuh hari"), s.halfDay, s.halfDay > 0 ? css.half : "")}
          {/* v1.171.0 — the punches' own figures, from the four-tile strip
              this card replaced: days with a punch, and the day's shifts
              added up (v1.133.0 pairing rule - the hours between two shifts
              are not worked hours). */}
          {daysPresent !== undefined && (
            <div className={css.stat} title={L("Days this month with attendance recorded", "Hari bulan ini dengan kehadiran direkodkan")}>
              <p className={css.statLabel}>{L("Present", "Hadir")}</p>
              <p className={css.statValue}>{daysPresent}<span className={css.statUnit}>{L("d", "h")}</span></p>
            </div>
          )}
          {hours !== undefined && (
            <div className={css.stat} title={L("Your shifts added up, per day", "Syif anda dijumlahkan, setiap hari")}>
              <p className={css.statLabel}>{L("Hours", "Jam")}</p>
              <p className={css.statValue}>{hours.toFixed(1)}<span className={css.statUnit}>h</span></p>
            </div>
          )}
          {has && (
            <div className={css.stat} title={L("Consecutive scheduled days on time, counting back from the last settled day this month", "Hari berjadual berturut-turut yang tepat waktu, dikira ke belakang dari hari terakhir yang selesai bulan ini")}>
              <p className={css.statLabel}>{L("Streak", "Rentetan")}</p>
              <p className={css.statValue}>{s.streak}<span className={css.statUnit}>{L("d", "h")}</span></p>
            </div>
          )}
        </div>
        {/* the month, as it happened — Monday-first, one cell per day */}
        {has && (
        <div className={css.calendar} aria-label={L("Day by day", "Hari demi hari")}>
          <div className={css.weekdays}>
            {(lang === "ms" ? ["I", "S", "R", "K", "J", "S", "A"] : ["M", "T", "W", "T", "F", "S", "S"]).map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className={css.days}>
            {Array.from({ length: offset }, (_, i) => <span key={`o${i}`} aria-hidden />)}
            {cells.map((c) => (
              <span
                key={c.date}
                title={`${dmy(c.date)} · ${c.status === "future" ? L("Upcoming", "Akan datang") : dayStatusL(c.status, lang)}${"in" in c && c.in ? ` · ${c.in}${c.out ? `–${c.out}` : ""}` : ""}`}
                className={`${css.day} ${c.status === "future" ? css.dayFuture : DAY_FILL[c.status] ?? ""}`}
              />
            ))}
          </div>
          <div className={css.legend}>
            <span className={css.legendItem}><i className={`${css.swatch} ${css.dayOnTime}`} />{L("on time", "tepat")}</span>
            <span className={css.legendItem}><i className={`${css.swatch} ${css.dayLate}`} />{L("late", "lewat")}</span>
            <span className={css.legendItem}><i className={`${css.swatch} ${css.dayAbsent}`} />{L("half day / absent", "separuh / tidak hadir")}</span>
            <span className={css.legendItem}><i className={`${css.swatch} ${css.dayOff}`} />{L("off", "cuti/rehat")}</span>
          </div>
        </div>
        )}
      </div>
      {!has && (
        <p className={css.monthNote} role="status">
          {L("Day-by-day verdicts (on time, late, half day) are not available right now — the figures above count your punches.", "Keputusan hari demi hari (tepat waktu, lewat, separuh hari) tidak tersedia sekarang — angka di atas mengira punch anda.")}
        </p>
      )}
      {notes.length > 0 && (
        <p className={css.monthNote}>{notes.join(" · ")}</p>
      )}
    </div>
  );
}

/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export function PunchToast({
  title,
  sub,
  variant = "success",
}: {
  title: string;
  sub: string;
  variant?: "success" | "notice";
}) {
  /* v1.124.0 — see SaveToast: the ring follows the theme now. */
  const colour = variant === "success" ? "var(--primary)" : "var(--warning)";
  return (
    <div className={css.toastLayer}>
      <style>{`
        @keyframes punch-pop { 0% { opacity: 0; transform: scale(.82) translateY(8px); } 60% { opacity: 1; transform: scale(1.03); } 100% { transform: scale(1); } }
        @keyframes punch-ring { from { stroke-dashoffset: 151; } to { stroke-dashoffset: 0; } }
        @keyframes punch-check { from { stroke-dashoffset: 36; } to { stroke-dashoffset: 0; } }
        @keyframes punch-fade { to { opacity: 0; } }
      `}</style>
      <div
        className={toastCard}
        style={{
          animation:
            "punch-pop .45s cubic-bezier(.2,.9,.3,1.2) both, punch-fade .4s ease .2s forwards",
          animationDelay: "0s, 2.2s",
        }}
        role="status"
        aria-live="polite"
      >
        <svg
          viewBox="0 0 52 52"
          className={css.toastRing}
          aria-hidden="true"
        >
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke={colour}
            strokeWidth="2.5"
            strokeDasharray="151"
            style={{ animation: "punch-ring .6s ease-out .1s both" }}
          />
          {variant === "success" ? (
            <path
              d="M15 27l7.5 7.5L37 20"
              fill="none"
              stroke={colour}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="36"
              style={{ animation: "punch-check .35s ease-out .55s both" }}
            />
          ) : (
            <g style={{ animation: "punch-check .35s ease-out .55s both" }}>
              <path
                d="M26 14v16"
                fill="none"
                stroke={colour}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="16"
              />
              <circle cx="26" cy="37" r="2.2" fill={colour} />
            </g>
          )}
        </svg>
        <p className={css.toastTitle}>{title}</p>
        <p className={css.toastSub}>{sub}</p>
      </div>
    </div>
  );
}

export function Dashboard({
  user,
  go,
  canOpen,
  onCreateQuotation,
  lang = "en",
  shiftOnly = false,
}: {
  user: User;
  go: (t: TabName) => void;
  onCreateQuotation?: () => void;
  /* v1.159.9 - whether this account's tab strip shows a tab (the page's own
     filter, overrides included). Absent = fall back to the role default. */
  canOpen?: (t: string) => boolean;
  lang?: Lang;
  shiftOnly?: boolean;
}) {
  /* v1.25.1: seeded from remembered data IN THE INITIALISER — seeding only
     the "known" flag left a single frame where the answer was declared known
     while the list was still empty, which printed the false message again. */
  const [today, setToday] = useState<{ type: string; created_at: string }[]>(
    () =>
      (cacheRead<DashCache>(DASH_ATT)?.records ?? []).filter(
        (r) => mytDateOf(r.created_at) === mytToday()
      )
  );
  /* v1.133.0 — today's shifts from the person's own pattern, every block. */
  const [todayShift, setTodayShift] = useState<DashCache["today_shift"]>(
    () => cacheRead<DashCache>(DASH_ATT)?.today_shift ?? null
  );
  /* v1.134.0 — the OT pair is back, AFTER the schedule (CEO: "after their
     working schedule, does they be able to OT clock in and out?"). */
  const [todayOt, setTodayOt] = useState<{ type: string; created_at: string }[]>(
    () => (cacheRead<DashCache>(DASH_ATT)?.ot ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
  );
  const [otEligible, setOtEligible] = useState(
    () => cacheRead<DashCache>(DASH_ATT)?.ot_eligible === true
  );
  /* v1.15.0: the same attendance response, kept un-filtered — powers the
     personal month chart and the KPI strip without a second request. */
  const [monthRecs, setMonthRecs] = useState<
    { type: string; created_at: string }[]
  >(() => cacheRead<DashCache>(DASH_ATT)?.records ?? []);
  /* v1.170.0 — the month's verdicts, from the same response. null = the
     worker did not send them (an older build, or the classifier could not
     run); the card is then simply not drawn rather than drawn wrong. */
  const [monthDays, setMonthDays] = useState<MonthDay[] | null>(
    () => cacheRead<DashCache>(DASH_ATT)?.days ?? null
  );
  /* v1.169.0: tasks, leave and news are one work panel. v1.171.0 (the CEO:
     "clean off my dashboard and resort it based on it own function"): the
     events join it as the fourth pill - the separate events/attendance card
     (v1.152.0) is gone, its attendance half folded into the month card.
     Bodies stay mounted (SectionTabs' rule). */
  const [aroundTab, setAroundTab] = useState<"tasks" | "leave" | "news" | "events">("tasks");
  const [leave, setLeave] = useState<LeaveReq[]>(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) ?? []
  );
  const [tasks, setTasks] = useState<Task[]>(() =>
    (cacheRead<Task[]>(DASH_TASKS) ?? [])
      .filter((x) => x.status !== "completed")
      .slice(0, 5)
  );
  const [anns, setAnns] = useState<Announcement[]>(
    () => cacheRead<Announcement[]>(DASH_ANNS) ?? []
  );
  /* v1.25.1 (CEO's screen recording: the card showed a green "Clock in" and
     "No attendance recorded today." for half a second — while he had ALREADY
     clocked in at 09:13). Root cause: `today` starts as [], which is
     indistinguishable from "loaded, and genuinely nothing". The card then
     states a confident WRONG answer and invites a second punch.
     Fix — UNKNOWN UNTIL PROVEN EMPTY: these flags say whether the answer is
     actually known yet. Unknown → skeleton. Known + empty → the real "None"
     message. They are SEEDED from remembered data, so a repeat open is not
     skeleton-then-truth but truth immediately (own punches are personal and
     non-financial, so instant display is safe). */
  const [attKnown, setAttKnown] = useState(
    () => cacheRead<DashCache>(DASH_ATT)?.as_of === mytToday()
  );
  const [attendanceError, setAttendanceError] = useState(false);
  const [leaveKnown, setLeaveKnown] = useState(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) !== null
  );
  const [tasksKnown, setTasksKnown] = useState(
    () => cacheRead<Task[]>(DASH_TASKS) !== null
  );
  const [annsKnown, setAnnsKnown] = useState(
    () => cacheRead<Announcement[]>(DASH_ANNS) !== null
  );
  const [busy, setBusy] = useState("");
  // v1.4.155: minute tick so the OT buttons appear at 18:00 MYT without a
  // manual refresh — the card is often left open on a phone all day.
  const [nowTick, setNowTick] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  /* v1.25.1: paint remembered data first (instant + correct), then refresh.
     The four requests below used to run one after another — four round-trips
     stacked end to end on a phone; they now go together. */
  const applyAtt = useCallback((d: DashCache) => {
    setMonthRecs(d.records ?? []);
    setMonthDays(Array.isArray(d.days) ? d.days : null);
    setToday(
      (d.records ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
    );
    setTodayShift(d.today_shift ?? null);
    setTodayOt((d.ot ?? []).filter((r) => mytDateOf(r.created_at) === mytToday()));
    setOtEligible(d.ot_eligible === true);
    setAttKnown(true);
    setAttendanceError(false);
  }, []);
  const applyTasks = useCallback((all: Task[]) => {
    setTasks(all.filter((x) => x.status !== "completed").slice(0, 5));
    setTasksKnown(true);
  }, []);
  const load = useCallback(async () => {
    const month = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 7);
    const [a, l, t] = await Promise.all([
      api<DashCache>(`/staff/attendance?month=${month}`),
      shiftOnly ? Promise.resolve({ data: null }) : api<{ leave: LeaveReq[] }>(`/staff/leave`),
      shiftOnly ? Promise.resolve({ data: null }) : api<{ tasks: Task[] }>(`/staff/tasks`),
    ]);
    if (a.ok && a.data && Array.isArray(a.data.records)) {
      applyAtt(a.data);
      cacheWrite(DASH_ATT, a.data);
    } else setAttendanceError(true);
    if (shiftOnly) return;
    const pending = (l.data?.leave ?? []).filter((x) => x.status === "pending");
    setLeave(pending);
    setLeaveKnown(true);
    if (l.data) cacheWrite(DASH_LEAVE, pending);
    applyTasks(t.data?.tasks ?? []);
    if (t.data) cacheWrite(DASH_TASKS, t.data.tasks ?? []);
    const n = await api<{ announcements: Announcement[] }>(
      `/staff/announcements`
    );
    setAnnsKnown(true);
    if (n.data?.announcements)
      cacheWrite(DASH_ANNS, n.data.announcements.slice(0, 3));
    setAnns((n.data?.announcements ?? []).slice(0, 3));
  }, [applyAtt, applyTasks, shiftOnly]);
  useEffect(() => {
    void load();
  }, [load]);
  /* v1.65.0 live: The dashboard is four cards in a trench coat, so it watches all four. */
  /* v1.139.0 - ...and the ROSTER topics too: today's shifts come from the live
     board and the task blocks, so a live booked for tonight left the phone
     saying "All shifts clocked" with Clock in disabled until a reload. */
  useLiveRefresh(["attendance", "leave", "tasks", "announcements", "live-sessions", "task-blocks"], load);
  /* v1.139.0 - AND WHEN THE DAY TURNS OVER. Everything on this card is
     computed from a fetch, and the only thing that triggers a new one is
     somebody else writing. A host who leaves the app open overnight and is
     the first to open it in the morning saw yesterday's card: "All shifts
     clocked", Clock in disabled, until she force-refreshed. */
  const dayRef = useRef(mytToday());
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setInterval(() => {
      const d = mytToday();
      if (d !== dayRef.current) { dayRef.current = d; void loadRef.current(); }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  

  const [punchToast, setPunchToast] = useState<{
    title: string;
    sub: string;
    variant?: "success" | "notice";
  } | null>(null);
  const [punchError, setPunchError] = useState("");
  /* v1.76.0 — the second tap. Armed by the first one, which explained what
     it will do; cleared as soon as any punch completes. */
  const [forgotArmed, setForgotArmed] = useState(false);
  /* v1.9.1 — office geofence replaces the selfie step. When a fence is set
     (management, Users tab), the punch grabs the phone's position first and
     the server refuses punches outside the radius. No fence → old behaviour. */
  const [fence, setFence] = useState<{
    configured: boolean;
    radius_m?: number;
    label?: string;
  } | null>(null);
  /* v1.17.0 — on-demand location check (CEO: "I still cant see the gps
     detection"). Runs the SAME server rule the punch enforces and mirrors
     the verdict back, without creating any record. Tap-initiated only: an
     automatic probe would fire the browser's location prompt on page open. */
  const [gpsCheck, setGpsCheck] = useState<
    | { state: "idle" | "busy" }
    | {
        state: "done";
        inside: boolean;
        distance_m: number;
        radius_m: number;
        label: string;
      }
    | { state: "error"; message: string; denied?: boolean }
  >({ state: "idle" });
  const checkLocation = async () => {
    setGpsCheck({ state: "busy" });
    const { gps, reason } = await getGpsFull();
    if (!gps) {
      /* v1.25.2: this used to say "blocked — check your browser settings" for
         EVERY failure, so staff who had already granted permission were sent
         to fix a setting that was correct. Each cause now gets its own words. */
      const msg =
        reason === "policy"
          ? lang === "ms"
            ? "Lokasi disekat oleh binaan laman web itu sendiri — bukan telefon anda. Maklumkan CEO/admin: deploy terkini perlu dijalankan (DEPLOY.bat penuh)."
            : "Location is blocked by the website build itself — NOT your phone. Tell the CEO/admin: the latest deploy needs to run (full DEPLOY.bat)."
          : reason === "denied"
            ? lang === "ms"
              ? "Lokasi disekat untuk laman ini — benarkan lokasi dalam tetapan tapak pelayar anda."
              : "Location is blocked for this site — allow it in your browser's site settings (the padlock/⋮ menu), not just in phone Settings."
            : reason === "unsupported"
              ? lang === "ms"
                ? "Pelayar ini tidak menyokong lokasi."
                : "This browser cannot provide location."
              : lang === "ms"
                ? "Tidak dapat isyarat lokasi — hidupkan Lokasi telefon, dekati tingkap dan cuba lagi."
                : "No location signal yet — switch phone Location ON, step near a window, then tap again.";
      setGpsCheck({
        state: "error",
        message: msg,
        denied: reason === "denied",
      });
      return;
    }
    const r = await api<{
      configured: boolean;
      inside?: boolean;
      distance_m?: number;
      radius_m?: number;
      label?: string;
    }>(`/staff/attendance/geofence/check`, {
      method: "POST",
      body: JSON.stringify({ gps }),
    });
    if (r.ok && r.data?.configured && typeof r.data.inside === "boolean") {
      setGpsCheck({
        state: "done",
        inside: r.data.inside,
        distance_m: r.data.distance_m ?? 0,
        radius_m: r.data.radius_m ?? 0,
        label: r.data.label ?? "the office",
      });
    } else {
      setGpsCheck({
        state: "error",
        message:
          lang === "ms"
            ? "Semakan gagal — cuba lagi."
            : "Check failed — try again.",
      });
    }
  };
  const fmtDist = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  useEffect(() => {
    void api<{ configured: boolean; radius_m?: number; label?: string }>(
      `/staff/attendance/geofence`
    ).then((r) => setFence(r.ok && r.data ? r.data : { configured: false }));
  }, []);
  /* v1.18.1: reports DENIED separately from "couldn't get a fix" — the CEO
     wants staff told when their punch was recorded without location, and
     "you blocked it" needs different words from "GPS timed out". */
  /* v1.25.2 (staff: "the location was not capture which is they already
     toggle on the location permission!" — screenshots showed Android
     permission correctly set to "Allow only while using the app" + precise
     location ON).
     THE BUG WAS OURS: a single high-accuracy request with a 10-second
     timeout. enableHighAccuracy asks the phone for a SATELLITE fix — which
     is exactly what does not work INSIDE a building, and inside the office
     is precisely where staff clock in. The request timed out, we reported
     "no location", and the person was told to check permissions they had
     already granted.
     Now it is staged: a short high-accuracy attempt (instant outdoors),
     then a fallback to NETWORK positioning (wifi/cell), which answers in
     about a second indoors and is accurate to tens of metres — far inside
     the 120 m office fence. A real denial short-circuits immediately; there
     is no point retrying a permission the person refused. */
  type GpsFail =
    "denied" | "timeout" | "unavailable" | "unsupported" | "policy";
  const getGpsFull = () =>
    new Promise<{
      gps: string | null;
      denied: boolean;
      reason: GpsFail | null;
    }>((resolve) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        resolve({ gps: null, denied: false, reason: "unsupported" });
        return;
      }
      /* v1.26.3: the v1.23.5 _headers shipped Permissions-Policy geolocation=()
       — the SITE ITSELF forbade location, and Android browsers enforce that
       as an instant "denied", which we mislabelled as the phone blocking it
       for three releases. Chromium exposes the policy — check it FIRST, so
       if a build ever forbids geolocation again it announces itself as a
       deploy problem instead of sending staff to fix innocent phones. */
      const fp = (
        document as unknown as {
          featurePolicy?: { allowsFeature?: (f: string) => boolean };
        }
      ).featurePolicy;
      if (fp?.allowsFeature && !fp.allowsFeature("geolocation")) {
        resolve({ gps: null, denied: true, reason: "policy" });
        return;
      }
      const ok = (p: GeolocationPosition) =>
        resolve({
          gps: `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)},${Math.round(p.coords.accuracy)}`,
          denied: false,
          reason: null,
        });
      const ask = (
        opts: PositionOptions,
        onFail: (e: { code: number }) => void
      ) => {
        // an insecure context throws synchronously — treat as unavailable
        try {
          navigator.geolocation.getCurrentPosition(ok, onFail, opts);
        } catch {
          onFail({ code: 2 });
        }
      };
      ask(
        { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
        (e1) => {
          if (e1.code === 1) {
            resolve({ gps: null, denied: true, reason: "denied" });
            return;
          }
          ask(
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 },
            (e2) => {
              resolve({
                gps: null,
                denied: e2.code === 1,
                reason:
                  e2.code === 1
                    ? "denied"
                    : e2.code === 3
                      ? "timeout"
                      : "unavailable",
              });
            }
          );
        }
      );
    });
  /* v1.21.6 (CEO: "On mobile, I cant see the details of the task assigned…
     how to notify staff that he has a assigned schedule and roaster? The
     dashboard mobile view doesnt show any"): the bell/push notification
     already fires on assignment — what was missing is a PLACE on the phone
     where the schedule lives. This card shows the person's own upcoming
     roster/live sessions right on the Dashboard, both breakpoints. */
  type MySess = {
    id: number;
    session_date: string;
    start_time: string;
    end_time?: string | null;
    platform: string;
    client_company?: string | null;
    client_name?: string | null;
    host_user_id: number;
    status: string;
    notes?: string | null;
  };
  const [mySessions, setMySessions] = useState<MySess[]>([]);
  useEffect(() => {
    if (shiftOnly) return;
    void api<{ sessions?: MySess[] }>(`/staff/live-sessions`).then((r) => {
      if (!r.ok || !r.data?.sessions) return;
      const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      setMySessions(
        r.data.sessions
          .filter(
            (s) =>
              s.host_user_id === user.id &&
              s.status === "scheduled" &&
              s.session_date >= todayIso
          )
          .slice(0, 5)
      );
    });
  }, [user.id, shiftOnly]);

  const punch = async (type: string, forgot = false) => {
    // v1.4.113: flow is clock IN → clock OUT. Trying to clock out before
    // clocking in gets an instant popup (and the server refuses it too).
    /* v1.76.0 (CEO: "if they forget to clock in or clock out, they will be
       able to clock in and out but system will require them to get the
       approval"). Refusing outright meant a worked day could not be recorded
       at all and simply vanished from payroll. Now the first tap explains,
       and a second tap sends it to the CEO — recorded, but counting for
       nothing until it is approved and the real time set. */
    if (type === "clock_out" && !todayShift?.entry?.clocked_in && !today.some((r) => r.type === "clock_in") && !forgot) {
      setPunchToast({
        title: L("You have not clocked in today", "Anda belum daftar masuk hari ini"),
        sub: L(
          "Tap Clock out again to send it to the CEO to approve — it will not count until then.",
          "Tekan Daftar keluar sekali lagi untuk hantar kepada CEO untuk kelulusan — ia tidak dikira sehingga itu."
        ),
        variant: "notice",
      });
      setForgotArmed(true);
      window.setTimeout(() => setPunchToast(null), 5200);
      return;
    }
    setBusy(type);
    setPunchError("");
    /* v1.18.1 (CEO): location is captured on EVERY punch, fence or no fence —
       fence OFF means it is recorded for the register without being enforced;
       fence ON keeps the server-side refusal. The prompt only ever fires on
       the punch tap itself (user-initiated), never on page load. */
    const { gps, denied: gpsDenied, reason: gpsReason } = await getGpsFull();
    // A likely duplicate (button shows ✓) is sent WITHOUT blocking on
    // location — the server answers "already punched" before the fence check.
    const likelyDup =
      type === "clock_in"
        ? today.some((r) => r.type === "clock_in")
        : today.some((r) => r.type === "clock_out");
    /* v1.21.4 (CEO): location is required on EVERY punch — no longer only
       when the fence config is present. The server refuses without it too;
       this check just gives the person the right words before a round-trip. */
    /* v1.25.3 (CEO: "record it, flag it loudly"): a phone whose permission is
       stuck must not cost someone their attendance record. The punch goes
       through carrying the REASON; the server stores it as NO LOCATION,
       shows it in red in the register and tells HR. We still say so plainly
       here so the person knows it was not a clean punch. */
    if (!gps && !likelyDup && gpsReason) {
      const res0 = await api<{ pending?: boolean; error?: { message?: string } }>(
        `/staff/attendance`,
        {
          method: "POST",
          body: JSON.stringify({ type, no_location_reason: gpsReason }),
        }
      );
      setBusy("");
      if (res0.queued) {
        setPunchToast({
          title: L("Kept — no signal", "Disimpan — tiada isyarat"),
          sub: L(
            "Saved on this phone with the time you pressed it. It will be sent the moment you are back online, and goes to the CEO to approve.",
            "Disimpan pada telefon ini dengan masa anda menekannya. Ia akan dihantar sebaik sahaja anda kembali dalam talian, dan dihantar kepada CEO untuk kelulusan.",
          ),
          variant: "notice",
        });
        window.setTimeout(() => setPunchToast(null), 6000);
        return;
      }
      if (res0.ok) {
        if (shiftOnly && type === "clock_in" && !res0.data?.pending) { go("Dashboard"); return; }
        setPunchToast({
          title:
            type === "clock_in"
              ? L(
                  "Clocked in — without location",
                  "Daftar masuk — tanpa lokasi"
                )
              : L(
                  "Clocked out — without location",
                  "Daftar keluar — tanpa lokasi"
                ),
          sub: gpsDenied
            ? L(
                "Recorded and flagged for HR. Your phone is blocking location for this site — fix it with the steps on the Dashboard so tomorrow's punch is clean.",
                "Direkodkan dan ditandakan untuk HR. Telefon anda menyekat lokasi untuk laman ini — betulkan dengan langkah di Papan Pemuka supaya punch esok bersih."
              )
            : L(
                "Recorded and flagged for HR — no GPS signal here. Try near a window next time.",
                "Direkodkan dan ditandakan untuk HR — tiada isyarat GPS di sini. Cuba berdekatan tingkap lain kali."
              ),
          variant: "notice",
        });
        window.setTimeout(() => setPunchToast(null), 6000);
        void load();
        return;
      }
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: gpsDenied
          ? L(
              `Location is blocked for THIS SITE — open the padlock/⋮ menu in your browser, allow Location, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again. (Phone Settings alone is not enough.)`,
              `Lokasi disekat untuk LAMAN INI — buka menu mangga/⋮ dalam pelayar anda, benarkan Lokasi, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula. (Tetapan telefon sahaja tidak mencukupi.)`
            )
          : L(
              `No location signal yet — check phone Location is ON, step near a window, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again.`,
              `Belum ada isyarat lokasi — pastikan Lokasi telefon HIDUP, dekati tingkap, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula.`
            ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4800);
      return;
    }
    const res = await api<{ flag?: string; pending?: boolean; ot_minutes?: number; error?: { message?: string } }>(
      `/staff/attendance`,
      {
        method: "POST",
        body: JSON.stringify({ type, ...(gps ? { gps } : {}), ...(forgot ? { forgot: true } : {}) }),
      }
    );
    setBusy("");
    setForgotArmed(false);
    /* v1.105.0 (roadmap phase 03) - no signal: the punch is KEPT on this
       phone (lib/outbox.ts) and sent when the network is back, carrying the
       time it was pressed. The CEO's decision: it is recorded at that time
       and goes to him to approve, like a forgotten punch. Say exactly that -
       "clocked in" would be a lie for another few minutes. */
    if (res.queued) {
      setPunchToast({
        title: type === "clock_in" ? L("Kept — no signal", "Disimpan — tiada isyarat") : L("Kept — no signal", "Disimpan — tiada isyarat"),
        sub: L(
          "Saved on this phone with the time you pressed it. It will be sent the moment you are back online, and goes to the CEO to approve.",
          "Disimpan pada telefon ini dengan masa anda menekannya. Ia akan dihantar sebaik sahaja anda kembali dalam talian, dan dihantar kepada CEO untuk kelulusan.",
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 6000);
      return;
    }
    if (res.ok && res.data?.pending) {
      setPunchToast({
        title: L("Sent to the CEO", "Dihantar kepada CEO"),
        sub: L(
          "Recorded and waiting for approval. It does not count towards your hours until the CEO approves it and sets the real time.",
          "Direkod dan menunggu kelulusan. Ia tidak dikira dalam jam kerja anda sehingga CEO meluluskannya dan menetapkan masa sebenar."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
      void load();
      return;
    }
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      // Already punched today — confirm it with the recorded time rather than
      // leaving the person unsure whether the tap registered.
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Already clocked in", "Sudah daftar masuk")
            : L("Already clocked out", "Sudah daftar keluar"),
        /* v1.133.0 — the server's sentence says what to do next ("clock out
           when this shift ends, then clock in again"), so it is shown whole. */
        sub: res.data?.error?.message ?? L("Recorded earlier today", "Direkodkan lebih awal hari ini"),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.flag) {
      if (shiftOnly && type === "clock_in") { go("Dashboard"); return; }
      const label: Record<string, string> = {
        ok: L("On time", "Tepat masa"),
        late: L("Marked late", "Ditanda lewat"),
        half_day: L("Late arrival: review required", "Ketibaan lewat: perlu semakan"),
        early_out: L("Early departure: leave approval is separate", "Keluar awal: kelulusan cuti berasingan"),
        completed: L("Shift completed", "Syif selesai"),
        /* v1.109.0 - a part-time host is paid by the clock; the punch says so
           instead of measuring her against hours that do not apply */
        hourly: L("Counted by the clock", "Dikira mengikut jam"),
        assigned: L("Assigned work", "Kerja yang ditugaskan"),
        rest_day: L("Rest day", "Hari rehat"),
      };
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const hhmm = now.toISOString().slice(11, 16);
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Clock-in recorded", "Daftar masuk direkodkan")
            : L("Clock-out recorded", "Daftar keluar direkodkan"),
        sub: `${label[res.data.flag] ?? res.data.flag} · ${hhmm} MYT${
          gps
            ? ""
            : gpsDenied
              ? L(
                  " · no location — enable location access for this site",
                  " · tiada lokasi — benarkan akses lokasi untuk laman ini"
                )
              : L(" · no location recorded", " · tiada lokasi direkodkan")
        }`,
        ...(gps ? {} : { variant: "notice" as const }),
      });
      window.setTimeout(() => setPunchToast(null), 2600);
      /* v1.133.0 — the clock-out that closed a shift also measured what lay
         outside the schedule. Say so now, in hours, with where it went: a
         person who worked the evening should not have to wonder whether
         anybody noticed. Shown after the punch toast so neither is lost. */
      const otM = res.data.ot_minutes ?? 0;
      if (type === "clock_out" && otM > 0) {
        const hm = `${Math.floor(otM / 60)}h${String(otM % 60).padStart(2, "0")}`;
        window.setTimeout(() => {
          setPunchToast({
            title: L(`${hm} overtime sent for approval`, `${hm} OT dihantar untuk kelulusan`),
            sub: L("Time outside your scheduled hours goes to the CEO to approve. You will get a bell either way.",
                   "Masa di luar waktu berjadual anda dihantar kepada CEO untuk kelulusan. Anda akan dapat loceng sama ada diluluskan atau tidak."),
            variant: "success",
          });
          window.setTimeout(() => setPunchToast(null), 5200);
        }, 2700);
      }
    } else if (
      (res.data?.error as { code?: string } | undefined)?.code === "no_shift"
    ) {
      /* v1.133.2 — nothing left to clock in for. The server's sentence names
         the shifts and what to do. */
      setPunchToast({
        title: L("No shift to clock in for", "Tiada syif untuk didaftar"),
        sub: res.data?.error?.message ?? L("Your shifts today are all clocked.", "Semua syif anda hari ini sudah didaftar."),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
      void load();
      return;
    } else if (
      (res.data?.error as { code?: string } | undefined)?.code === "no_clock_in"
    ) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub:
          res.data?.error?.message ??
          L(
            "Clock in before clocking out.",
            "Daftar masuk sebelum daftar keluar."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else if (
      ["too_far", "location_required"].includes(
        (res.data?.error as { code?: string } | undefined)?.code ?? ""
      )
    ) {
      // v1.9.1: geofence refusals get a toast, not the red error line — being
      // outside the fence is expected behaviour, not a system fault.
      setPunchToast({
        title:
          (res.data?.error as { code?: string }).code === "too_far"
            ? L("Too far from the office", "Terlalu jauh dari pejabat")
            : L("Location needed", "Lokasi diperlukan"),
        sub:
          res.data?.error?.message ??
          L(
            "Move closer to the office and try again.",
            "Dekati pejabat dan cuba lagi."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
    } else {
      setPunchError(
        res.data?.error?.message ??
          L("Punch failed — try again.", "Punch gagal — cuba lagi.")
      );
    }
    void load();
  };

  /* v1.134.0 — OT in / OT out. Opens only after the working schedule (the
     worker says so: today_shift.can_ot), records the stretch, and the pair
     goes straight to the CEO as pending. */
  const punchOt = async (type: string) => {
    setBusy(type);
    setPunchError("");
    const { gps, denied: otDenied } = await getGpsFull();
    if (!gps) {
      setBusy("");
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: otDenied
          ? L("OT punches need your location — allow location access and try again.", "Punch OT memerlukan lokasi anda — benarkan akses lokasi dan cuba lagi.")
          : L("No GPS fix yet — step outside or wait a moment, then try again.", "Belum ada isyarat GPS — keluar sebentar atau tunggu, kemudian cuba lagi."),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4200);
      return;
    }
    const res = await api<{ at?: string; ot_minutes?: number; error?: { message?: string } }>("/staff/attendance/ot", {
      method: "POST",
      body: JSON.stringify({ type, gps }),
    });
    setBusy("");
    if (res.ok && res.data?.at) {
      const m = res.data.ot_minutes ?? 0;
      const hm = `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
      setPunchToast({
        title: type === "ot_in" ? L("OT in recorded", "OT masuk direkodkan") : L(`${hm} overtime sent for approval`, `${hm} OT dihantar untuk kelulusan`),
        sub: type === "ot_in"
          ? L(`${res.data.at} MYT — tap OT out when you finish.`, `${res.data.at} MYT — tekan OT out apabila selesai.`)
          : L("The CEO decides it. Approved overtime goes straight into your payroll, and you get a bell either way.",
              "CEO yang memutuskan. OT yang diluluskan terus masuk ke gaji anda, dan anda akan dapat loceng sama ada diluluskan atau tidak."),
        variant: "success",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
    } else {
      setPunchToast({ title: L("Overtime", "OT"), sub: res.data?.error?.message ?? L("OT punch failed — try again.", "Punch OT gagal — cuba lagi."), variant: "notice" });
      window.setTimeout(() => setPunchToast(null), 4800);
    }
    void load();
  };

  /* v1.133.0 — A DAY IS A LIST OF SHIFTS.
     CEO, 07-09-2026: "I want my staff being clock in and out based on their
     working schedule ... 11:00am to 05:00pm then next shift schedule 08:00pm
     to 10:00pm ... OT is based on outside of their working schedule."

     `today` arrives newest-first. Whether the person is clocked in RIGHT NOW
     is the type of the latest punch — not "has a clock-in happened today",
     which was true from 11:00 until midnight and made the evening shift
     unrecordable. Clock in is offered whenever nothing is open; Clock out
     whenever something is. The OT in / OT out buttons (v1.4.155) are gone:
     the clock-out that closes a shift is what tells the worker how much of
     it lay outside the schedule, and that lands with the CEO as overtime by
     itself. */
  const latestPunch = today[0]?.type ?? null;
  const openNow = todayShift?.entry?.clocked_in ?? (latestPunch === "clock_in");
  const shiftsToday = today.filter((r) => r.type === "clock_in").length;
  /* v1.171.0 - hasIn went with the four-tile strip (its "Today" tile); the
     hero's own line already says when the day's punches happened. */
  const hasOut = today.some((r) => r.type === "clock_out");
  const openSince = openNow ? mytTime(todayShift?.entry?.open_since ?? today[0]?.created_at ?? "") : null;
  const clockOutAt = todayShift?.entry?.clock_out_at;
  const clockOutDue = !attendanceError && openNow && !!clockOutAt && nowTick >= Date.parse(clockOutAt) - 30 * 60000;
  /* v1.133.2 — Clock in is offered only while there is a SHIFT to clock in
     for: a pattern block, a roster task or a live session not yet clocked.
     The worker decides (today_shift.can_clock_in); an older worker that does
     not say is treated as "yes" so the button never dies on a stale API. */
  const canClockIn = todayShift?.can_clock_in ?? true;
  const shiftsLeft = (todayShift?.slots ?? []).filter((x) => !x.claimed).length;
  const hasOtIn = todayOt.some((r) => r.type === "ot_in");
  const hasOtOut = todayOt.some((r) => r.type === "ot_out");
  /* OT is offered after the schedule (nothing open, nothing left to clock in
     for), to eligible staff, until the day's pair is complete. Kept visible
     once an OT in exists so the OT out can never lose its button. */
  const showOt = otEligible && !openNow && ((todayShift?.can_ot ?? false) || (hasOtIn && !hasOtOut));

  /* v1.15.0 — personal month stats from the punches already fetched.
     v1.133.0 — hours are the SUM OF THE DAY'S SHIFTS, paired in the order
     they happened: in, out, in, out. First-in-to-last-out would count the
     three hours at home between an afternoon and an evening shift. A shift
     still open contributes presence but no hours (honest: we don't know the
     total yet). Same pairing rule the worker runs (clock-day.ts). */
  const dayPairs = (() => {
    const m = new Map<string, { hours: number; open: boolean }>();
    const byDay = new Map<string, { type: string; t: number }[]>();
    for (const r of monthRecs) {
      const d = mytDateOf(r.created_at);
      const list = byDay.get(d) ?? [];
      list.push({ type: r.type, t: new Date(r.created_at.replace(" ", "T") + "Z").getTime() });
      byDay.set(d, list);
    }
    for (const [d, list] of byDay) {
      list.sort((a, b) => a.t - b.t);
      let hours = 0, openAt: number | null = null;
      for (const x of list) {
        if (x.type === "clock_in") { if (openAt === null) openAt = x.t; }
        else if (x.type === "clock_out" && openAt !== null) {
          hours += Math.min((x.t - openAt) / 3_600_000, 16);
          openAt = null;
        }
      }
      m.set(d, { hours, open: openAt !== null });
    }
    return m;
  })();
  const daysPresent = dayPairs.size;
  const monthHours = Array.from(dayPairs.values()).reduce((a, e) => a + e.hours, 0);
  /* ===================================================================
     v1.175.0 — WHICH JOB THIS PERSON OPENED THE PORTAL TO DO.

     The dashboard has always read in one order for everybody: clock in,
     then what is waiting, then the month, then the company. That is the
     right order for the person whose day starts with a punch, and the
     wrong one for the person who signs things: the CEO, 22-09-2026, on
     his own dashboard — *"attendance shouldn't dominate"*.

     So the ZONES are unchanged and the ORDER is chosen:
       business  the executive tier — the company first, then the
                 decisions waiting on them, and their own attendance in a
                 tighter card below it
       sales     a salesperson — their follow-ups first, then the targets
                 they are measured against, then the clock
       shift     everybody else — the clock first, exactly as before

     THIS GRANTS NOTHING. Every zone still asks its own question: the
     company card returns null unless the viewer passes revenue_view or
     the executive check inside trading-desk.tsx, the watchers card
     returns null outside WATCHER_ROLES, and the desk lists only what the
     worker says this person may act on. Re-ordering a list of elements
     cannot widen any of that — which is exactly why the layout is a list
     of elements and not a second set of role checks.
     =================================================================== */
  const lead: DashboardLead =
    WATCHER_ROLES.includes(user.role) ? "business"
      : (canOpen ? canOpen("Sales") || canOpen("Ecommerce") : SALES_ROLES.includes(user.role)) ? "sales"
        : "shift";

  /* Daily actions and pending work precede metrics and company reporting. */
  const zoneDay = (
      <section className="erp-stack-tight">
        <ZoneLabel>{L("My day", "Hari saya")}</ZoneLabel>
      {/* v1.115.0 — QUICK ACTIONS FIRST. The CEO, 05-09-2026, with the
          Dashboard on screen: *"Quick actions should be on the top so that
          user easily to click. also on the mobile apps view"*. Clock in is
          the one thing everybody does every day; it was three cards down,
          under the desk and the watchers. The card is unchanged, only
          moved - on every screen size, since the phone view is the same
          tree. */}
      <div className={`erp-shift-hero ${shiftOnly ? css.heroNarrow : lead === "shift" ? "" : css.heroCompact}`}>
        {/* "On shift" once clocked in (the reference design's heading),
            "Quick actions" before that. */}
        <div className={css.heroHead}>
        <div className={css.heroTitleRow}>
        <PanelTitle icon="time" className={css.heroTitle} tone="inherit">
          {shiftOnly ? L("On Shift", "Syif Saya") : openNow ? tr("On shift", lang) : tr("Quick actions", lang)}
        </PanelTitle>
        {/* v1.172.1 (Interface System V3): the state of the day, said once
            as a chip a member of staff can read at arm's length - on shift
            since when, clocked out, or not yet in. Drawn only once the
            punches are KNOWN (v1.25.1). */}
        {attKnown && !attendanceError && (
          <span className={`erp-chip ${openNow ? "erp-chip-success" : hasOut ? "erp-chip-neutral" : "erp-chip-warning"}`} role="status">
            {openNow
              ? L(`On shift since ${openSince}`, `Dalam syif sejak ${openSince}`)
              : hasOut ? L("Clocked out", "Sudah daftar keluar") : L("Not clocked in yet", "Belum daftar masuk")}
          </span>
        )}
        </div>
        {/* v1.172.1: a compact link beside the title on every width - as a
            full-width pill it read as the first action on a phone. */}
        <button type="button" className={btnSm} onClick={() => go(shiftOnly ? "Dashboard" : "On Shift")}>
          <AppIcon name={shiftOnly ? "next" : "time"} className="erp-icon" />
          {shiftOnly ? L("Dashboard", "Papan Pemuka") : L("On Shift", "Syif Saya")}
        </button>
        </div>
        {todayShift?.entry?.leave_review && <p role="status" className={css.heroWarn}>{L("Your leave coverage needs management review.", "Tempoh cuti anda perlu semakan pengurusan.")}</p>}
        {/* v1.4.146: 2-up grid on phones — equal-width, thumb-friendly, no
            ragged wrapping; the desktop keeps its inline row. v1.10.0: the
            flip moved sm→md so the whole mobile shell (nav, hero, cards,
            buttons) switches at ONE breakpoint. */}
        {/* v1.25.1: until the punches are KNOWN, show skeleton buttons — never
            a green "Clock in" for someone who already clocked in. */}
        {attendanceError && (
          <div role="alert" className={css.heroAlert}>
            <span>{L("Attendance could not be refreshed. Check your connection and retry.", "Kehadiran tidak dapat dimuat semula. Semak sambungan dan cuba lagi.")}</span>
            <button type="button" className={btnHero} onClick={() => void load()}>
              <AppIcon name="refresh" className="erp-icon" />{L("Retry", "Cuba lagi")}
            </button>
          </div>
        )}
        {!attKnown ? !attendanceError && (
          <div
            className={css.actionsSkel}
            aria-busy="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} className={css.actionSkel} h={44} round="full" />
            ))}
          </div>
        ) : (
          <div className={shiftOnly ? css.actionsShift : css.actions}>
            {/* v1.172.1: one button height everywhere (the 44px contract) -
                the On Shift tab used to grow its two buttons to 56px. */}
            <button
              type="button"
              className={btnHeroPrimary}
              disabled={!!busy || openNow || !canClockIn}
              onClick={() => void punch("clock_in")}
            >
              {openNow
                ? `${tr("Clocked in ✓", lang)} ${openSince}`
                : !canClockIn
                  ? L("All shifts clocked ✓", "Semua syif didaftar ✓")
                : <><AppIcon name="place" />
                    {shiftsToday > 0 ? L("Clock in · next shift", "Daftar masuk · syif seterusnya") : tr("Clock in", lang)}</>}
            </button>
            <button
              type="button"
              className={btnHero}
              disabled={!!busy}
              onClick={() => void punch("clock_out", forgotArmed)}
            >
              {!openNow && hasOut ? tr("Clocked out ✓", lang) : tr("Clock out", lang)}
            </button>
            <button
              type="button"
              className={btnHero}
              onClick={() => go("Leave")}
            >
              {tr("Apply leave", lang)}
            </button>
            {/* v1.159.9 - a quick action into a tab this account cannot see
                bounced to the Dashboard it was pressed on; the strip's own
                answer decides, so an unticked Sales tab hides the button. */}
            {!shiftOnly && (canOpen ? canOpen("Sales") : SALES_ROLES.includes(user.role)) && (
              <button
                type="button"
                className={btnHero}
                onClick={() => onCreateQuotation ? onCreateQuotation() : go("Sales")}
              >
                {tr("Create quotation", lang)}
              </button>
            )}
            {showOt && (
              <>
                <button type="button" className={hasOtIn ? btnHero : btnHeroPrimary} disabled={!!busy || hasOtIn}
                  onClick={() => void punchOt("ot_in")}>
                  {hasOtIn ? "OT in ✓" : "OT in"}
                </button>
                <button type="button" className={btnHero} disabled={!!busy || !hasOtIn || hasOtOut}
                  onClick={() => void punchOt("ot_out")}>
                  {hasOtOut ? "OT out ✓" : "OT out"}
                </button>
              </>
            )}
          </div>
        )}
        {showOt && !hasOtOut && (
          <p className="erp-note erp-note-warning erp-mt-2">
            {L("Working on after your schedule? Tap OT in when overtime starts and OT out when you finish — it goes to the CEO to approve, and approved overtime is paid on your payslip.",
               "Bekerja selepas jadual anda? Tekan OT in apabila OT bermula dan OT out apabila selesai — ia dihantar kepada CEO untuk kelulusan, dan OT yang diluluskan dibayar pada slip gaji anda.")}
          </p>
        )}
        {punchError && (
          <p className={css.punchError}>
            {punchError}
          </p>
        )}
        {punchToast && (
          <PunchToast
            title={punchToast.title}
            sub={punchToast.sub}
            variant={punchToast.variant}
          />
        )}
        {/* v1.9.1: clock-out reminder — mirrors the 18:30/22:00 bell + push
            from the cron, for the person who has the tab open right now. */}
        {clockOutDue && (
          <p className="erp-note erp-note-warning erp-mt-2">
            <AppIcon name="time" className={css.noteIcon} />{tr("Don't forget to clock out", lang)}{" "}
            — {tr("tap Clock out before you leave.", lang)}
          </p>
        )}
        {/* v1.133.0 — the shifts this person is due to clock for today, from
            their own pattern, every block of it. Said on the card because
            the rule is new: one Clock in and one Clock out PER SHIFT, and
            anything worked outside these hours goes to the CEO as overtime
            without a second pair of buttons. */}
        {attKnown && todayShift && (
          <p className={css.shiftsNote}>
            {/* v1.133.2 — the SHIFTS, including roster and live-board
                assignments, not only the pattern. One clock-in per shift;
                a day with none has nothing to clock in for. */}
            {shiftOnly ? (todayShift.entry?.work_label === "" ? L("No remaining scheduled hours", "Tiada baki waktu berjadual")
                : L(`Scheduled hours: ${todayShift.entry?.work_label ?? todayShift.slots_label ?? todayShift.label}`, `Waktu berjadual: ${todayShift.entry?.work_label ?? todayShift.slots_label ?? todayShift.label}`))
              : (todayShift.slots?.length ?? todayShift.windows.length) === 0
              ? L("Rest day on your pattern. If you work today, clock in and out once — the CEO decides whether it counts as overtime or replacement leave.",
                  "Hari rehat pada corak anda. Jika anda bekerja hari ini, daftar masuk dan keluar sekali — CEO memutuskan sama ada ia dikira OT atau cuti gantian.")
              : L(`Today's shifts: ${todayShift.slots_label ?? todayShift.label}. One clock in and out per shift${shiftsLeft > 0 && shiftsToday > 0 ? ` — ${shiftsLeft} left` : ""}. Time outside your working hours is sent to the CEO as overtime.`,
                  `Syif hari ini: ${todayShift.slots_label ?? todayShift.label}. Satu daftar masuk dan keluar bagi setiap syif${shiftsLeft > 0 && shiftsToday > 0 ? ` — ${shiftsLeft} lagi` : ""}. Masa di luar waktu bekerja anda dihantar kepada CEO sebagai OT.`)}
          </p>
        )}
        {fence?.configured && (
          <>
            {/* v1.15.0 — phone: the reference's readiness strip. Config only,
                deliberately NOT a live GPS probe: reading the position here
                would fire the browser's location prompt on every Dashboard
                open, before the person asked to punch. The real check stays
                where it belongs — server-side, at the punch. */}
            <div className={`erp-note ${css.fenceNote}`}>
              <div className={css.fenceHead}>
                <span className={css.fenceLabel}>
                  <ShieldOk
                    aria-hidden
                    className="erp-icon"
                    strokeWidth={1.75}
                  />
                  {lang === "ms"
                    ? "Semakan lokasi pejabat aktif"
                    : "Office location check is on"}
                </span>
                <button
                  type="button"
                  onClick={() => void checkLocation()}
                  disabled={gpsCheck.state === "busy"}
                  className="erp-button erp-button-accent erp-button-compact"
                >
                  {gpsCheck.state === "busy"
                    ? lang === "ms"
                      ? "Menyemak…"
                      : "Checking…"
                    : lang === "ms"
                      ? "Semak lokasi saya"
                      : "Check my location"}
                </button>
              </div>
              {gpsCheck.state === "done" && (
                <p
                  className={`${css.fenceResult} ${gpsCheck.inside ? css.inside : css.outside}`}
                >
                  <span
                    aria-hidden
                    className={css.fenceDot}
                  />
                  {gpsCheck.inside
                    ? lang === "ms"
                      ? `Dalam kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}`
                      : `Inside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}`
                    : GEOFENCE_EXEMPT_ROLES.includes(user.role)
                      ? lang === "ms"
                        ? `${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label} — lokasi anda direkodkan`
                        : `${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label} — your location is recorded`
                      : lang === "ms"
                        ? `Luar kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}. Daftar masuk direkodkan & DITANDAKAN untuk HR.`
                        : `Outside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}. Your punch is recorded and FLAGGED for HR.`}
                </p>
              )}
              {gpsCheck.state === "error" && (
                <p className={css.fenceError}>
                  {gpsCheck.message}
                </p>
              )}
            </div>
            <p className={css.fenceLine}>
              {tr("Office check-in is on", lang)} —{" "}
              {GEOFENCE_EXEMPT_ROLES.includes(user.role)
                ? lang === "ms"
                  ? "lokasi anda direkodkan pada setiap daftar masuk/keluar."
                  : "your location is recorded with every punch."
                : lang === "ms"
                  ? `punch memerlukan lokasi; di luar ${fence.radius_m ?? 120} m dari ${fence.label ?? "pejabat"} ia direkodkan dan ditandakan untuk HR.`
                  : `punches require your location; outside ${fence.radius_m ?? 120} m of ${fence.label ?? "the office"} they are recorded and flagged for HR.`}{" "}
              <button
                type="button"
                className={css.fenceCheck}
                onClick={() => void checkLocation()}
                disabled={gpsCheck.state === "busy"}
              >
                {gpsCheck.state === "busy"
                  ? lang === "ms"
                    ? "Menyemak…"
                    : "Checking…"
                  : lang === "ms"
                    ? "Semak lokasi saya"
                    : "Check my location"}
              </button>
              {gpsCheck.state === "done" && (
                <span
                  className={`${css.fenceVerdict} ${gpsCheck.inside ? css.inside : css.outside}`}
                >
                  {gpsCheck.inside
                    ? L(
                        `✓ ${fmtDist(gpsCheck.distance_m)} — inside`,
                        `✓ ${fmtDist(gpsCheck.distance_m)} — dalam kawasan`
                      )
                    : L(
                        `${fmtDist(gpsCheck.distance_m)} — outside${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch will be flagged)"}`,
                        `${fmtDist(gpsCheck.distance_m)} — luar kawasan${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch akan ditandakan)"}`
                      )}
                </span>
              )}
              {gpsCheck.state === "error" && (
                <>
                  <span className={css.fenceMessage}>
                    {gpsCheck.message}
                  </span>
                  {/* v1.25.3: "tap the padlock" is impossible when the portal
                      was opened from a home-screen icon — the steps below are
                      chosen from what this phone actually is. */}
                  {gpsCheck.denied && <LocationHelp lang={lang} />}
                </>
              )}
            </p>
          </>
        )}
        {!attKnown ? (
          <Skel className={css.punchesSkel} h={12} w={192} />
        ) : (
          <p className={css.punches}>
            {today.length === 0 && todayOt.length === 0
              ? L(
                  "No attendance recorded today.",
                  "Tiada kehadiran direkodkan hari ini."
                )
              : `${L("Today", "Hari ini")}: ${[...today.slice().reverse(), ...todayOt.slice().reverse()]
                  .map(
                    (r) =>
                      `${
                        getLang() === "ms"
                          ? ((
                              { clock_in: "masuk", clock_out: "keluar", ot_in: "OT masuk", ot_out: "OT keluar" } as Record<string, string>
                            )[r.type] ?? r.type)
                          : r.type.startsWith("ot_") ? r.type.replace("ot_", "OT ") : r.type.replace("_", " ")
                      } ${mytTime(r.created_at)}`
                  )
                  .join(" · ")}${shiftsToday > 1 ? ` · ${shiftsToday} ${L("shifts", "syif")}` : ""}`}
          </p>
        )}
      </div>

      </section>
  );

  const zoneDesk = (
      <section id="one-desk" className="erp-stack-tight">
        <ZoneLabel>{L("Waiting on me", "Menunggu saya")}</ZoneLabel>
      {/* v1.106.0 (roadmap phase 04) — ONE DESK. Everything waiting on this
          person, from every module. One quiet line when there is nothing.
          v1.115.0: it follows the Quick actions card - the CEO put the
          clock-in first - and stays above everything else. */}
      {/* v1.171.0 — ONE FRAME for the executive tier (the CEO, 20-09-2026,
          chose "One Desk + Watchers merged"): the desk first, the watchers'
          findings under a rule in the same card. Everyone else sees the desk
          alone, as before - its own card when it has work, one quiet line
          when it has none. */}
      {WATCHER_ROLES.includes(user.role) ? (
        <div className={card}>
          <OneDesk go={(t) => go(t as TabName)} userId={user.id} bare />
          <WatchersCard role={user.role} go={(t) => go(t as TabName)} bare />
        </div>
      ) : (
        <OneDesk go={(t) => go(t as TabName)} userId={user.id} />
      )}
      </section>
  );

  const zoneMonth = (
      <section className="erp-stack-tight">
        <ZoneLabel>{L("My month", "Bulan saya")}</ZoneLabel>
      {/* v1.171.0 — ONE card for the month. The four-tile strip (today's
          clock-in, days present, hours, open tasks) said what the hero and
          the Work overview already say; the bar chart behind a pill drew the
          same punches a third way. Days present and hours now sit inside the
          month card beside the verdicts. v1.25.1's rule still holds: the
          figures derive from the punches, so a skeleton until those are
          KNOWN - never "0 days" for someone whose month has not loaded. */}
      {!attKnown ? (
        <div className={card} aria-busy="true"><SkelText lines={3} /></div>
      ) : (
        <MonthAttendanceCard days={monthDays} month={mytToday().slice(0, 7)} lang={lang} daysPresent={daysPresent} hours={monthHours} />
      )}
      </section>
  );

  const zoneCompany = (
    <>
      {/* v1.171.0 — THE COMPANY, one card (mode="pulse"). The Sales floor
          moved to Ecommerce, the attendance donut and today's assignments to
          Attendance, the bars with the floor. See trading-desk.tsx. */}
      <TradingDesk user={user} go={go} lang={lang} mode="pulse" />
    </>
  );

  const zoneAround = (
      <section className="erp-stack-tight">
        <ZoneLabel>{L("Around me", "Sekeliling saya")}</ZoneLabel>
      {/* v1.169.0: Tasks, leave and news are one work panel. The previous
          mobile checklist plus three desktop cards repeated the same records
          and made the bottom half of the Dashboard read as six destinations.
          v1.171.0: the events are the fourth pill (the CEO chose "Tasks |
          Leave | News | Events"); the #upcoming-events anchor moves here. */}
      <div id="upcoming-events" className={`${card} ${css.overviewAnchor}`}>
        <div className={css.overviewHead}>
          <div>
            <PanelTitle icon="orders">{L("Work overview", "Ringkasan kerja")}</PanelTitle>
            <p className="erp-meta erp-mt-half">
              {L("Your tasks, leave requests, company updates and upcoming events.", "Tugasan, permohonan cuti, kemas kini syarikat dan acara akan datang anda.")}
            </p>
          </div>
          <SectionTabs value={aroundTab} onChange={setAroundTab}
            tabs={[
              ["tasks", `${tr("My open tasks", lang)}${tasks.length ? ` (${tasks.length})` : ""}`],
              ["leave", `${tr("Pending leave", lang)}${leave.length ? ` (${leave.length})` : ""}`],
              ["news", tr("News", lang)],
              ["events", L("Events", "Acara")],
            ] as const} />
        </div>
        <div hidden={aroundTab !== "tasks"} className={css.pane}>
          {!tasksKnown ? <SkelText lines={3} /> : tasks.length === 0 ? (
            <p className="erp-text-sm erp-muted">{tr("Nothing assigned.", lang)}</p>
          ) : (
            <ul className={css.list}>
              {tasks.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <button type="button" className={css.listItem} onClick={() => go("Tasks")}>
                    <span className={`erp-avatar ${css.listIconGold}`}><AppIcon name="orders" className="erp-icon" /></span>
                    <span className={css.listText}><span className={css.listTitle}>{t.title}</span><span className={css.listSub}>{priorityL(t.priority)}{t.deadline ? L(` · due ${dmy(t.deadline)}`, ` · sebelum ${dmy(t.deadline)}`) : ""}</span></span>
                    <AppIcon name="next" className={`erp-icon ${css.listChevron}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div hidden={aroundTab !== "leave"} className={css.pane}>
          {!leaveKnown ? <SkelText lines={3} /> : leave.length === 0 ? (
            <p className="erp-text-sm erp-muted">{tr("None pending.", lang)}</p>
          ) : (
            <ul className={css.list}>
              {leave.slice(0, 4).map((l) => (
                <li key={l.id}>
                  <button type="button" className={css.listItem} onClick={() => go("Leave")}>
                    <span className="erp-avatar"><AppIcon name="date" className="erp-icon" /></span>
                    <span className={css.listText}><span className={css.listTitle}>{leaveTypeL(l.type)}</span><span className={css.listSub}>{dmy(l.start_date)} → {dmy(l.end_date)} · {l.days}d</span></span>
                    <AppIcon name="next" className={`erp-icon ${css.listChevron}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div hidden={aroundTab !== "news"} className={css.pane}>
          {!annsKnown ? <SkelText lines={3} /> : anns.length === 0 ? (
            <p className="erp-text-sm erp-muted">{tr("No announcements.", lang)}</p>
          ) : (
            <ul className={css.list}>
              {anns.slice(0, 4).map((a) => (
                <li key={a.id}>
                  <button type="button" className={css.listItem} onClick={() => go("Announcements")}>
                    <span className="erp-avatar"><AppIcon name="chat" className="erp-icon" /></span>
                    <span className={css.listText}><span className={css.listTitle}>{a.title}</span><span className={css.listSub}>{annCatL(a.category)}</span></span>
                    <AppIcon name="next" className={`erp-icon ${css.listChevron}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div hidden={aroundTab !== "events"} className={css.pane}>
          {/* v1.21.6 — My schedule: the person's own upcoming roster/live
              sessions, on the Dashboard where the phone actually opens.
              v1.171.0: under the Events pill, above the company calendar - what
              is coming up, mine first. */}
          {mySessions.length > 0 && (
            <div className={css.schedule}>
              <p className={css.scheduleTitle}>
                {lang === "ms" ? "Jadual saya" : "My schedule"}
              </p>
              <p className="erp-meta erp-mt-half">
                {lang === "ms"
                  ? "Sesi roster yang ditetapkan kepada anda — anda dimaklumkan setiap kali satu ditambah atau dipindah."
                  : "Roster sessions assigned to you — you are notified whenever one is added or moved."}
              </p>
              <div className={css.scheduleList}>
                {mySessions.map((s) => {
                  const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
                    .toISOString()
                    .slice(0, 10);
                  const isToday = s.session_date === todayIso;
                  return (
                    <div
                      key={s.id}
                      className={css.session}
                    >
                      <p className={css.sessionWhen}>
                        <span
                          className={`${css.sessionDate} ${isToday ? css.sessionToday : ""}`}
                        >
                          {isToday
                            ? lang === "ms"
                              ? "HARI INI"
                              : "TODAY"
                            : dmy(s.session_date)}
                        </span>
                        <span className={css.sessionTime}>
                          {s.start_time}
                          {s.end_time ? `–${s.end_time}` : ""}
                        </span>
                        <span className={chipSmNeutral}>
                          {s.platform}
                        </span>
                      </p>
                      <p className={css.sessionWhat}>
                        {s.client_company ??
                          s.client_name ??
                          L("Live session", "Sesi LIVE")}
                        {s.notes ? (
                          <span className={css.sessionNotes}>
                            {" "}
                            — {s.notes}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <UpcomingEventsCard role={user.role} embedded />
        </div>
      </div>
      </section>
  );

  const ZONES: Record<DashboardZone, ReactNode> = {
    day: zoneDay, desk: zoneDesk, month: zoneMonth, company: zoneCompany, around: zoneAround,
  };
  return (
    <div className={css.page}>
      {/* v1.15.0 — mobile Today greeting: date line + time-of-day hello, the
          top of the reference's phone screen. Phones only; the desktop header
          already greets. */}
      <div className={css.greeting}>
        <p className={css.greetingDate}>
          {mytTodayLine(lang)}
        </p>
        <h2 className={css.greetingTitle}>
          {mytGreeting(lang)}, {user.name.split(" ")[0]}
        </h2>
      </div>
      {/* v1.175.0 — one set of zones, the order chosen by what this person
          came to do. On Shift stays a single zone: it is the clock, alone. */}
      {shiftOnly ? zoneDay : DASHBOARD_ZONES[lead].map((k) => <Fragment key={k}>{ZONES[k]}</Fragment>)}
    </div>
  );
}

/* ================= Sales revenue (v1.4.75) ================= */

export const REVENUE_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "cco",
  "sales_marketing",
  "marketing",
  "hr_admin",
];

export interface RevenueData {
  month: string;
  last_month: string;
  today?: {
    date: string;
    tiktok_cents: number;
    tiktok_orders: number;
    invoiced_cents: number;
    invoiced_docs: number;
    other_cents?: number;
    manual_cents?: number;
  };
  yesterday?: { date: string; total_cents: number }; // v1.4.206 trend arrow
  other?: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  }; // v1.4.169 non-TikTok shipments
  manual?: {
    this_cents: number;
    this_units: number;
    last_cents: number;
    last_units: number;
  }; // v1.4.169 manual sales
  tiktok: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  };
  invoiced: {
    this_cents: number;
    this_docs: number;
    last_cents: number;
    last_docs: number;
  };
  outstanding?: { cents: number; docs: number };
  overall?: {
    total_cents: number;
    months: { month: string; cents: number }[];
    best?: { month: string; cents: number };
  }; // v1.4.276 all-time, all channels
  target_cents?: number | null;
  next_month?: string;
  last_target_cents?: number | null;
  next_target_cents?: number | null;
}

/** Sales revenue at a glance — TikTok order amounts (captured by the sync)
    plus invoices issued, this month vs last. */
/* v1.4.270 — the brand-toned hero band (CEO approved: "firmly brand-toned,
   and hero band + row bars"). Structure from his reference screenshot,
   palette from the brand: ONE navy solid card for the single most important
   number, white + gold for the rest — the v1.4.253 one-fill rule applied to
   cards. Renders progressively: each card appears when its data arrives, and
   a role that can't see revenue simply gets the cards it can see. */
export interface DashSummary {
  today: string;
  pending_leave: number | null;
  pending_claims: number | null;
  pending_ot: number | null;
  low_stock: number | null;
  open_quotations: number | null;
  // v1.7.0 company pulse
  clients?: number | null;
  active_stokis?: number | null;
  lives_today?: number | null;
  attendance_today?: number | null;
  outstanding_invoices?: number | null;
  cash_in_cents?: number | null;
  cash_out_cents?: number | null;
  // v1.8.0 attendance donut
  attendance_on_time?: number | null;
  attendance_late?: number | null;
  staff_total?: number | null;
}

/* ================= v1.5.0 — the Sales Floor (trading-desk dashboard) =======
   CEO brief: "my dashboard nice like a trading sales view — Today sales,
   market target for my product and service, KPI target and motivation for
   them to hit the requirement and suggestion to boost the sales."

   One live view, four zones:
   1. TICKER   — today's number in market green/red vs yesterday, month,
                 all-time, unpaid (collections are revenue already earned).
   2. KPI      — the month target with a pace marker. The target is AUTO-
                 COMPUTED from history (beat last month by 10%, rounded up to
                 the next RM500); a manually set target always wins.
   3. MARKETS  — product vs service, each line measured against its own
                 auto-target (its last month + 10%).
   4. DESK NOTES — motivation tied to the actual pace, plus concrete,
                 data-driven suggestions to boost sales (best live hour,
                 unpaid invoices, open quotations, restocks).
   Calendar and quick actions are untouched — this replaces only the band. */

export interface RevLineLite {
  key: string;
  label: string;
  total_cents: number;
  months: { month: string; cents: number }[];
}
export interface HourBucket {
  hour: number;
  cents: number;
  orders: number;
}

/** Auto-target: beat last month by 10%, rounded UP to the next RM500.
    No history yet → no target (never invent a number). */
export function autoTargetCents(lastCents: number): number | null {
  if (lastCents <= 0) return null;
  const raised = lastCents * 1.1;
  return Math.ceil(raised / 50_000) * 50_000;
}

export function ActiveStokisSummary({ inModal }: { inModal?: boolean } = {}) {
  const [data, setData] = useState<
    { id: number; name: string; status: string; month_cents: number }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      stokis: {
        id: number;
        name: string;
        status: string;
        month_cents: number;
      }[];
    }>("/staff/stokis").then((r) => {
      if (r.ok && r.data)
        setData(r.data.stokis.filter((s) => s.status === "active"));
      setLoaded(true);
    });
  }, []);
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className={css.summaryModal}>{node}</div>
    ) : (
      <div className={card}>
        <p className={css.summaryTitle}>
          ⭐ {L("Active Stokis", "Stokis aktif")}
        </p>
        {node}
      </div>
    );
  if (!loaded)
    return wrap(
      <SkelRows rows={4} className={inModal ? css.summarySkelModal : css.summarySkelCard} />
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? css.summaryEmptyModal
            : css.summaryEmptyCard
        }
      >
        {L("No active stokis.", "Tiada stokis aktif.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? css.summaryListModal : css.summaryListCard
      }
    >
      {data.map((s) => (
        <div
          key={s.id}
          className={`${css.summaryRow} ${inModal ? css.summaryRowModal : css.summaryRowCard}`}
        >
          <p className={css.summaryName}>{s.name}</p>
          <p className={css.summaryDetail}>
            {fmtRM(s.month_cents)} {L("this month", "bulan ini")}
          </p>
        </div>
      ))}
    </div>
  );
}

/* v1.21.0 (CEO chose "allow but flag") — punches outside the office are
   RECORDED and management views mark them red; the C-suite is exempt from
   the flag but their location still shows. Display only: the location
   requirement is enforced server-side at the punch. */
export const GEOFENCE_EXEMPT_ROLES = ["ceo", "coo", "cco"];

/* v1.18.1 — where a punch happened, as a human phrase. The stored gps is
   "lat,lng[,acc]"; distance is measured against the CONFIGURED fence when
   the caller has one (monitor ships it), falling back to SITE_CONFIG.
   Accuracy grace mirrors the server: radius + min(acc, 150). */
export function gpsLabel(
  gps?: string | null,
  fence?: { lat: number; lng: number; radius_m: number; label?: string } | null
): { text: string; ok: boolean | null; dist: number | null } {
  if (!gps)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  // v1.25.3: deliberately-unlocated punch — surface it as a failure, not a blank.
  if (gps.startsWith("no_location:")) {
    const why = gps.slice("no_location:".length);
    return {
      text:
        why === "denied"
          ? L("NO LOCATION (blocked)", "TIADA LOKASI (disekat)")
          : why === "policy"
            ? L(
                "NO LOCATION (site build blocked it — redeploy)",
                "TIADA LOKASI (disekat oleh binaan laman — deploy semula)"
              )
            : L(`NO LOCATION (${why})`, `TIADA LOKASI (${why})`),
      ok: false,
      dist: null,
    };
  }
  const m =
    /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?/.exec(
      gps
    );
  if (!m)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  const office = fence ?? {
    lat: SITE_CONFIG.office.lat,
    lng: SITE_CONFIG.office.lng,
    radius_m: SITE_CONFIG.office.radiusM,
  };
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  const acc = m[3] ? Math.min(Number(m[3]), 150) : 0;
  const rad = Math.PI / 180;
  const dLat = (office.lat - lat) * rad;
  const dLng = (office.lng - lng) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(office.lat * rad) * Math.sin(dLng / 2) ** 2;
  const dist = Math.round(
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
  const near = dist <= office.radius_m + acc; // same rule as the server gate
  return {
    text:
      dist >= 1000
        ? L(
            `${(dist / 1000).toFixed(1)} km from HQ`,
            `${(dist / 1000).toFixed(1)} km dari HQ`
          )
        : L(`${dist} m from HQ`, `${dist} m dari HQ`),
    ok: near,
    dist,
  };
}

export function InTodaySummary({ inModal }: { inModal?: boolean } = {}) {
  type MonRow = {
    id: number;
    name: string;
    role?: string;
    in_at?: string | null;
    in_gps?: string | null;
  };
  const [data, setData] = useState<MonRow[]>([]);
  const [fence, setFence] = useState<{
    lat: number;
    lng: number;
    radius_m: number;
    label?: string;
  } | null>(null);
  /* v1.21.4: distinguish "worker says fence is NOT configured" (explicit
     null → show the red deployment warning) from "old worker, field absent"
     (undefined → say nothing rather than guess). */
  const [fenceMissing, setFenceMissing] = useState(false);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      staff: MonRow[];
      geofence?: {
        lat: number;
        lng: number;
        radius_m: number;
        label?: string;
      } | null;
    }>("/staff/attendance/monitor").then((r) => {
      if (r.ok && r.data) {
        setData(r.data.staff.filter((s) => !!s.in_at));
        setFence(r.data.geofence ?? null);
        setFenceMissing("geofence" in r.data && r.data.geofence === null);
      }
      setLoaded(true);
    });
  }, []);
  /* v1.21.4: when the deployed worker explicitly reports NO fence, tell the
     manager plainly — this is the silent state behind "no location" punches
     being accepted before, and the fix is one full DEPLOY.bat run. */
  const fenceWarning = fenceMissing ? (
    <p
      className={`${css.fenceMissing} ${inModal ? css.fenceMissingModal : css.fenceMissingCard}`}
    >
      Office geofence is NOT active on this deployment — run DEPLOY.bat in full
      (step 2 seeds it via migration 0072), then punches require location and
      outside-office flags turn on.
    </p>
  ) : null;
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className={css.summaryModal}>
        {fenceWarning}
        {node}
      </div>
    ) : (
      <div className={card}>
        <p className={css.summaryTitle}>
          {L("In Today", "Hadir hari ini")}
        </p>
        {fenceWarning}
        {node}
      </div>
    );
  if (!loaded)
    return wrap(
      <SkelRows rows={4} className={inModal ? css.summarySkelModal : css.summarySkelCard} />
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? css.summaryEmptyModal
            : css.summaryEmptyCard
        }
      >
        {L("No one checked in today.", "Tiada sesiapa daftar masuk hari ini.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? css.summaryListModal : css.summaryListCard
      }
    >
      {data.map((u) => (
        <div
          key={u.id}
          className={`${css.summaryRow} ${inModal ? css.summaryRowModal : css.summaryRowCard}`}
        >
          <p className={css.summaryWho}>{u.name}</p>
          {/* v1.15.0 fix (audit finding): in_at is a UTC string — slicing it
              showed a 10:00 MYT clock-in as 02:00. mytTime converts. */}
          <p className={css.summaryDetail}>
            {L("Checked in at", "Daftar masuk pada")}{" "}
            {u.in_at ? mytTime(u.in_at) : L("unknown", "tidak diketahui")}
            {(() => {
              /* v1.21.0 allow-but-flag: staff outside the fence show RED
                 ("outside office"); CEO/COO/CCO are exempt from the flag —
                 their distance shows neutrally. Missing location on a staff
                 punch is amber (older rows predate the requirement). */
              const g = gpsLabel(u.in_gps, fence);
              const exempt = GEOFENCE_EXEMPT_ROLES.includes(u.role ?? "");
              if (g.ok === null)
                return (
                  <span
                    className={exempt ? css.faded : css.flagWarn}
                  >
                    · {g.text}
                  </span>
                );
              if (exempt)
                return (
                  <span className={css.faded}>
                    · {g.text}
                  </span>
                );
              return g.ok ? (
                <span className={css.flagOk}>
                  · {L("at office", "di pejabat")} · {g.text}
                </span>
              ) : (
                <span className={css.flagBad}>
                  · {L("OUTSIDE OFFICE", "LUAR PEJABAT")} · {g.text}
                </span>
              );
            })()}
          </p>
        </div>
      ))}
    </div>
  );
}

export function OutstandingDocsSummary({ kind }: { kind: "INV" | "QT" }) {
  const [data, setData] = useState<SalesDoc[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ docs: SalesDoc[] }>("/staff/docs").then((r) => {
      if (r.ok && r.data)
        setData(
          /* v1.154.0 - an invoiced quotation is a sale, not an open quote */
          r.data.docs.filter(
            (d) => d.doc_type === kind && d.payment_status !== "paid" && !(kind === "QT" && d.invoiced_as)
          )
        );
      setLoaded(true);
    });
  }, [kind]);
  if (!loaded) return <SkelRows rows={4} className={css.deskSkel} />;
  if (data.length === 0)
    return (
      <p className={css.deskEmpty}>
        {L(
          `No ${kind === "INV" ? "unpaid invoices" : "open quotations"}.`,
          kind === "INV"
            ? "Tiada invois belum dibayar."
            : "Tiada sebut harga terbuka."
        )}
      </p>
    );
  return (
    <div className={css.deskList}>
      {data.map((d) => (
        <div
          key={d.id}
          className={css.deskRow}
        >
          <span className={css.summaryWho}>
            {d.doc_number}{" "}
            <span className={css.sessionNotes}>
              ({d.company})
            </span>
          </span>
          <span className={`${css.deskMoney} ${css.deskMoneyBad}`}>
            {fmtRM(d.total_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PendingLeaveSummary() {
  const [data, setData] = useState<LeaveReq[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ leave: LeaveReq[] }>("/staff/leave?all=1").then((r) => {
      if (r.ok && r.data)
        setData(r.data.leave.filter((l) => l.status === "pending"));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className={css.deskSkel} />;
  if (data.length === 0)
    return (
      <p className={css.deskEmpty}>
        {L("No pending leave requests.", "Tiada permohonan cuti menunggu.")}
      </p>
    );
  return (
    <div className={css.deskList}>
      {data.map((l) => (
        <div
          key={l.id}
          className={css.deskRow}
        >
          <p className={css.summaryWho}>
            {l.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className={css.sessionNotes}>
              ({l.days} {L("days", "hari")})
            </span>
          </p>
          <p className={css.summaryDetail}>
            {l.start_date} {L("to", "hingga")} {l.end_date}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PendingClaimsSummary() {
  const [data, setData] = useState<
    {
      id: number;
      user_name: string;
      category: string;
      amount_cents: number;
      status: string;
    }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      claims: {
        id: number;
        user_name: string;
        category: string;
        amount_cents: number;
        status: string;
      }[];
    }>("/staff/claims").then((r) => {
      if (r.ok && r.data)
        setData(r.data.claims.filter((c) => c.status === "pending"));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className={css.deskSkel} />;
  if (data.length === 0)
    return (
      <p className={css.deskEmpty}>
        {L("No pending claims.", "Tiada tuntutan menunggu.")}
      </p>
    );
  return (
    <div className={css.deskList}>
      {data.map((c) => (
        <div
          key={c.id}
          className={css.deskRow}
        >
          <p className={css.summaryWho}>
            {c.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className={css.sessionNotes}>
              - {c.category}
            </span>
          </p>
          <span className={css.deskMoney}>
            {fmtRM(c.amount_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LowStockSummary() {
  const [data, setData] = useState<
    { id: number; name: string; sku: string; stock: number }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      items: { id: number; name: string; sku: string; stock: number }[];
    }>("/staff/inventory").then((r) => {
      if (r.ok && r.data && r.data.items)
        setData(r.data.items.filter((i) => (i.stock || 0) <= 5));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className={css.deskSkel} />;
  if (data.length === 0)
    return (
      <p className={css.deskEmpty}>
        {L("No low stock items.", "Tiada barang stok rendah.")}
      </p>
    );
  return (
    <div className={css.deskList}>
      {data.map((i) => (
        <div
          key={i.id}
          className={css.deskRow}
        >
          <p className={css.summaryWho}>
            {i.name}{" "}
            <span className={css.sessionNotes}>({i.sku})</span>
          </p>
          <span className={`${css.deskMoney} ${css.deskMoneyBad}`}>
            {L(`${i.stock} left`, `baki ${i.stock}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
