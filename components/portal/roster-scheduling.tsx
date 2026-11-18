"use client";

/* v1.328.0 - ROSTER & SCHEDULING (the CEO, 16-11-2026: "Perform everything",
   approving R-1 ... R-6 of claude/ROSTER-SCHEDULING-STAGE-0-AUDIT.md).

   ONE workspace over the two scheduling engines that already exist - nothing
   here is a new engine, route, table or permission:

     E1  the operational roster   GET /staff/roster (lives, task blocks,
                                   sales duty) - RosterBoard, TodayAssignmentsCard
     E2  the expected schedule    GET /staff/attendance/roster (patterns,
                                   leave, holidays) - ShiftRoster, Shift Templates

   Five views, the view in the address (/portal?tab=Roster+%26+Scheduling&view=):

     Today            the day's figures, today's live assignments (managers,
                      as on Tasks before) and who works today
     Roster Board     RosterBoard, moved from Tasks > Calendar with its gates
     Shift Roster     ShiftRoster, moved from Attendance; staff see their row
     Shift Templates  the pattern editor (it was a drawer inside Shift Roster);
                      the four roles that edited it before
     Live Reports     LiveReports (v1.368.0, the CEO's picture of 18-11-2026; it
                      replaced LiveHostCard, which came from Tasks > Reports, R-4)

   The components moved WHOLE, with their own reads, writes and gates. A view
   mounts the first time it is opened and then stays mounted, hidden. */

import { useCallback, useEffect, useState } from "react";
import { PersonDayDrawer } from "@/components/portal/attendance-records";
import { TodayAssignmentsCard } from "@/components/portal/dashboard-cards";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { AttendanceAdminPanel, RosterBoard } from "@/components/portal/lazy-panels";
import { L, MANAGE_ROLES, revealAnchor, type User } from "@/components/portal/page-shared";
import { ShiftRoster } from "@/components/portal/shift-roster";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { LiveReports } from "@/components/portal/live-reports"; // v1.368.0 - replaces LiveHostCard (the CEO's picture, 18-11-2026)
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { SkelRows } from "@/components/ui/skeleton";
import { holds } from "@/lib/caps";
import { useCachedApi } from "@/lib/cached-api";
import { mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import type { TabName } from "@/lib/portal-tabs";
import { useTabViewAddress } from "@/lib/tab-view";
import { btnSm, card, chipSmInfo, chipSmNeutral, chipSmSuccess } from "@/lib/ui-styles";
import { leaveWord } from "./attendance-shared";
import css from "./attendance4.module.css";
import rs from "./roster-scheduling.module.css";

export const ROSTER_TAB = "Roster & Scheduling" as const;
export type RosterView = "today" | "board" | "shifts" | "templates" | "reports";
/* the anchors the Dashboard, the bell and old links reveal, and the view that holds each */
const ANCHOR_VIEW: Record<string, RosterView> = { "roster-board": "board", "shift-roster": "shifts", "live-host-card": "reports" };
/* the gates, unchanged from where each card came from */
const ROSTER_MANAGE = ["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"];  // RosterBoard canManage (Tasks > Calendar)
const ROSTER_EDIT = ["ceo", "coo", "cco", "super_admin", "admin"];               // RosterBoard canEdit, TodayAssignmentsCard canManage
const TEMPLATE_ROLES = ["ceo", "super_admin", "admin", "hr_admin"];               // Shift Templates (Attendance > Shift Roster)

type Day = { d: string; kind: "work" | "rest" | "leave" | "holiday" | "not_employed"; label?: string | null; pattern?: string | null; leave_type?: string; holiday?: string; partial_leave?: string | null; assigned?: boolean };
type Roster = { scope: "team" | "own"; staff: { id: number; name: string; position: string | null; department: string | null; days: Day[] }[] };
type Session = { id: number; session_date: string; status: string; host_user_id?: number };

export function RosterScheduling({ user, go, startView }: { user: User; go: (t: TabName) => void; startView?: string }) {
  const manage = MANAGE_ROLES.includes(user.role);
  const canTemplates = TEMPLATE_ROLES.includes(user.role);
  const views: readonly RosterView[] = canTemplates ? ["today", "board", "shifts", "templates", "reports"] : ["today", "board", "shifts", "reports"];
  const isView = useCallback((v: string | null): v is RosterView => !!v && (views as readonly string[]).includes(v), [views]);
  const [view, setView] = useState<RosterView>(() => (isView(startView ?? null) ? startView as RosterView : "today"));
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if (isView(startView ?? null)) setView(startView as RosterView); }
  useTabViewAddress(ROSTER_TAB, view, setView, isView);
  const [seen, setSeen] = useState<readonly RosterView[]>([view]);
  if (!seen.includes(view)) setSeen([...seen, view]);
  const on = (v: RosterView) => seen.includes(v);
  const [person, setPerson] = useState<{ id: number; day: string } | null>(null);
  const openPerson = (id: number, day: string) => setPerson({ id, day });

  /* an anchor revealed from elsewhere opens the view that holds it first */
  useEffect(() => {
    const onReveal = (e: Event) => { const v = ANCHOR_VIEW[(e as CustomEvent<string>).detail]; if (v) setView(v); };
    window.addEventListener("azone:reveal", onReveal);
    return () => window.removeEventListener("azone:reveal", onReveal);
  }, []);

  const NAMES: Record<RosterView, [string, string]> = {
    today: [L("Today", "Hari Ini"), L("Today's assignments and who works", "Tugasan hari ini dan siapa bekerja")],
    board: [L("Roster Board", "Papan Roster"), L("Lives, task blocks and sales duty by week", "Live, blok tugasan dan tugas jualan mengikut minggu")],
    shifts: [L("Shift Roster", "Roster Syif"), L("The expected working schedule", "Jadual kerja dijangka")],
    templates: [L("Shift Templates", "Templat Syif"), L("Working-hour patterns", "Corak waktu kerja")],
    reports: [L("Live Reports", "Laporan Live"), L("Report or review a live", "Lapor atau semak live")],
  };

  return (
    <TabPage className={css.page}>
      <div className="erp-desktop-only">
        <LineTabs value={view} onChange={(k) => setView(k)} tabs={views.map((v) => [v, NAMES[v][0]] as const)} label={L("Roster & Scheduling", "Roster & Penjadualan")} testid="roster-view" />
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="roster-view-bar">
        <ViewSwitch value={view} onChange={(k) => setView(k)} label={L("Roster view", "Paparan roster")} options={views.map((v) => [v, NAMES[v][0], NAMES[v][1]] as const)} />
      </div>

      {on("today") && (
        <div hidden={view !== "today"} className={css.body} data-testid="roster-today">
          <RosterToday manage={manage} canEdit={ROSTER_EDIT.includes(user.role)} me={user.id} openPerson={manage ? openPerson : undefined}
            openBoard={() => setView("board")} openShifts={() => setView("shifts")} openAttendance={() => go("Attendance")} />
        </div>
      )}

      {on("board") && (
        <div hidden={view !== "board"} className={css.body}>
          <TabZone label={L("Roster board", "Papan roster")} hint={L("Lives, task blocks and sales duty by week - the one place a live is created or changed.", "Live, blok tugasan dan tugas jualan mengikut minggu - satu-satunya tempat live dicipta atau diubah.")}>
            <div id="roster-board" className={rs.anchor}>
              <RosterBoard
                canManage={ROSTER_MANAGE.includes(user.role)}
                canEdit={ROSTER_EDIT.includes(user.role)}
                /* mirrors task_delete in worker/src/permissions.ts (the CEO alone), as on Tasks before */
                canDeleteTask={holds("task_delete", ["ceo", "super_admin"].includes(user.role))}
              />
            </div>
          </TabZone>
        </div>
      )}

      {on("shifts") && (
        <div hidden={view !== "shifts"} className={css.body} id="shift-roster">
          <ShiftRoster canTemplates={canTemplates} role={user.role} openPerson={manage ? openPerson : undefined} onTemplates={canTemplates ? () => setView("templates") : undefined} />
        </div>
      )}

      {canTemplates && on("templates") && (
        <div hidden={view !== "templates"} className={css.body} data-testid="roster-templates-view">
          <section className={card} aria-label={L("Shift templates", "Templat syif")}>
            <div className={css.head}>
              <div className={css.headText}>
                <p className={css.title}>{L("Shift Templates", "Templat Syif")}</p>
                <p className={css.sub}>{L("Working-hour patterns and who works which, from a date - so a month already measured never moves.", "Corak waktu kerja dan siapa bekerja mengikut corak mana, dari satu tarikh - supaya bulan yang telah diukur tidak berubah.")}</p>
              </div>
              <button type="button" className={btnSm} onClick={() => setView("shifts")}><AppIcon name="date" />{L("See the roster", "Lihat roster")}</button>
            </div>
          </section>
          <AttendanceAdminPanel role={user.role} areas={["hours"]} showPending={false} bare />
        </div>
      )}

      {on("reports") && (
        <div hidden={view !== "reports"} className={css.body}>
          <div id="live-host-card"><LiveReports /></div>
        </div>
      )}

      {manage && <PersonDayDrawer target={person} onClose={() => setPerson(null)} goExceptions={() => { setPerson(null); go("Attendance"); revealAnchor("pending-punches"); }} />}
    </TabPage>
  );
}

/* ---- Today: the day's figures, today's lives, who works today ---- */
function RosterToday({ manage, canEdit, me, openPerson, openBoard, openShifts, openAttendance }: {
  manage: boolean; canEdit: boolean; me: number; openPerson?: (id: number, day: string) => void;
  openBoard: () => void; openShifts: () => void; openAttendance: () => void;
}) {
  const today = mytToday();
  const r = useCachedApi<Roster>(`/staff/attendance/roster?from=${today}&to=${today}`, true, ["attendance"]);
  const lives = useCachedApi<{ sessions: Session[] }>("/staff/roster", true, ["roster"]);
  /* the managing roles read the monitor already (On Shift, Attendance); nobody else asks */
  const mon = useCachedApi<{ staff: { last_type: string | null }[] }>(manage ? "/staff/attendance/monitor" : null, manage, ["attendance"]);
  const dayOf = (p: Roster["staff"][number]) => p.days.find((d) => d.d === today);
  const staff = (r.data?.staff ?? []).filter((p) => { const d = dayOf(p); return d && d.kind !== "not_employed"; });
  const working = staff.filter((p) => dayOf(p)?.kind === "work");
  const leave = staff.filter((p) => dayOf(p)?.kind === "leave");
  const off = staff.filter((p) => { const k = dayOf(p)?.kind; return k === "rest" || k === "holiday"; });
  const livesToday = (lives.data?.sessions ?? []).filter((s) => s.session_date === today && s.status !== "cancelled");
  const mineToday = livesToday.filter((s) => s.host_user_id === me);
  const onNow = (mon.data?.staff ?? []).filter((m) => m.last_type === "clock_in").length;
  const own = r.data?.scope === "own";
  const mineDay = own ? (r.data?.staff[0] ? dayOf(r.data.staff[0]) : undefined) : undefined;
  const ownWord = !mineDay ? "—" : mineDay.kind === "work" ? (mineDay.label ?? L("Working", "Bekerja")) : mineDay.kind === "leave" ? leaveWord(mineDay.leave_type) : mineDay.kind === "holiday" ? L("Public holiday", "Cuti umum") : L("Off", "Rehat");
  const chip = (d: Day | undefined) => !d ? null
    : d.kind === "work" ? <span className={chipSmSuccess}>{d.label ?? L("Working", "Bekerja")}</span>
    : d.kind === "leave" ? <span className={chipSmInfo}>{leaveWord(d.leave_type)}</span>
    : d.kind === "holiday" ? <span className={chipSmNeutral}>{d.holiday ?? L("Public holiday", "Cuti umum")}</span>
    : <span className={chipSmNeutral}>{L("Off", "Rehat")}</span>;
  const row = (p: Roster["staff"][number]) => {
    const d = dayOf(p);
    const body = (
      <>
        <span className={css.listText}><strong>{properName(p.name)}</strong><span className={css.muted}>{[p.position, p.department].filter(Boolean).join(" · ") || "—"}{d?.pattern ? ` · ${d.pattern}` : ""}</span></span>
        {d?.assigned && <span className={chipSmNeutral} title={L("A live, task block or sales duty on the roster today", "Live, blok tugasan atau tugas jualan dalam roster hari ini")}>{L("On the board", "Dalam papan")}</span>}
        {chip(d)}
      </>
    );
    return (
      <li key={p.id} data-testid="today-person">
        {openPerson ? <button type="button" className={rs.personBtn} onClick={() => openPerson(p.id, today)} aria-label={`${p.name} - ${L("open the day", "buka hari")}`}>{body}</button> : body}
      </li>
    );
  };
  return (
    <>
      <KpiRow label={L("Today", "Hari ini")}>
        {own ? (
          <KpiTile icon="date" tone="green" label={L("Your Shift Today", "Syif Anda Hari Ini")} value={ownWord} busy={!r.data} sub={mineDay?.pattern ?? L("From your working-hour pattern", "Daripada corak waktu kerja anda")} onClick={openShifts} />
        ) : (
          <KpiTile icon="date" tone="green" label={L("Scheduled Today", "Dijadualkan Hari Ini")} value={working.length} busy={!r.data} sub={L(`of ${staff.length} on the roster`, `daripada ${staff.length} dalam roster`)} onClick={openShifts} testid="roster-fig-scheduled" />
        )}
        {manage && <KpiTile icon="time" tone="gold" label={L("On Shift Now", "Sedang Syif")} value={onNow} busy={!mon.data} sub={L("Clocked in · open Attendance", "Daftar masuk · buka Kehadiran")} onClick={openAttendance} testid="roster-fig-on" />}
        {!own && <KpiTile icon="holiday" tone="blue" label={L("On Leave", "Bercuti")} value={leave.length} busy={!r.data} sub={L(`${off.length} off or on a holiday`, `${off.length} rehat atau cuti umum`)} />}
        <KpiTile icon="live" tone="red" label={own ? L("Your Lives Today", "Live Anda Hari Ini") : L("Lives Today", "Live Hari Ini")} value={own ? mineToday.length : livesToday.length} busy={!lives.data} sub={L("On the roster board", "Dalam papan roster")} onClick={openBoard} testid="roster-fig-lives" />
      </KpiRow>
      {manage && (
        <TabZone label={L("Today's assignments", "Tugasan hari ini")}>
          <TodayAssignmentsCard canManage={canEdit} onOpenRoster={openBoard} />
        </TabZone>
      )}
      <TabZone label={own ? L("Your day", "Hari anda") : L("Who works today", "Siapa bekerja hari ini")}>
        <section className={card} aria-label={L("Who works today", "Siapa bekerja hari ini")} data-testid="today-people">
          <div className={css.head}>
            <div className={css.headText}>
              <p className={css.title}>{own ? L("Your Day", "Hari Anda") : L("Who Works Today", "Siapa Bekerja Hari Ini")}</p>
              <p className={css.sub}>{L("From each working-hour pattern, with approved leave and holidays laid over it.", "Daripada corak waktu kerja setiap orang, dengan cuti diluluskan dan cuti umum.")}</p>
            </div>
            <button type="button" className={btnSm} onClick={openShifts}><AppIcon name="date" />{L("Week and month", "Minggu dan bulan")}</button>
          </div>
          {!r.data ? <SkelRows rows={4} /> : staff.length === 0 ? <p className={css.empty}>{L("Nobody is on the roster today.", "Tiada sesiapa dalam roster hari ini.")}</p> : (
            <ul className={`${css.list} ${rs.people}`}>
              {[...working, ...leave, ...off].map(row)}
            </ul>
          )}
        </section>
      </TabZone>
    </>
  );
}
