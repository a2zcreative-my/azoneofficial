"use client";

/* v1.307.0 - ATTENDANCE WORKSPACE 4.0 (the CEO, 14-11-2026: "approve as the
   recommendation and correct it the error issue" on
   claude/ATTENDANCE-WORKSPACE-4.0-BLUEPRINT.md, A-0 ... A-12). One clean
   workspace, five views, the view in the address (/portal?tab=Attendance&view=),
   the Dashboard's view switch on a phone:

     Overview               today, from THE verdict (attendance-overview.tsx)
     Attendance Records     the day register and one person's day
                            (attendance-records.tsx); a member of staff sees
                            their own month here
     Shift Roster           the computed roster and Shift Templates
                            (shift-roster.tsx); staff see their own row
     Exceptions & Approvals forgotten punches and overtime - the Desk's own
                            decisions (attendance-exceptions.tsx), and the
                            correction card moved from Settings
     Reports                the month reconciled, trend, breakdown, exports
                            (attendance-reports.tsx)

   WHAT LEFT: the "On Shift" tab (a second door to the punch page - the
   sidebar's On Shift is the one place a punch is made); the Settings tab
   (corrections -> Exceptions & Approvals, working hours -> Shift Templates,
   unpaid days -> Leave); the operational roster board (lives, task blocks,
   sales duty) -> Tasks > Calendar (A-3). The status rule is ONE function in
   the worker (attendance-day.ts) - no view decides "not clocked in" for
   itself. No permission changed but one (A-8: raw coordinates, CEO only). */

import { holds } from "@/lib/caps";
import { useCallback, useEffect, useState } from "react";
import { Attendance, type AttendanceMine } from "@/components/portal/attendance";
import { AttendanceOverview, type AttView } from "@/components/portal/attendance-overview";
import { AttendanceExceptions } from "@/components/portal/attendance-exceptions";
import { AttendanceRecords, PersonDayDrawer } from "@/components/portal/attendance-records";
import { AttendanceReports } from "@/components/portal/attendance-reports";
import { DailyAttendanceChart } from "@/components/portal/attendance-chart";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { L, MANAGE_ROLES, type User } from "@/components/portal/page-shared";
import { ShiftRoster } from "@/components/portal/shift-roster";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { mytToday } from "@/lib/format";
import type { TabName } from "@/lib/portal-tabs";
import { useTabViewAddress } from "@/lib/tab-view";
import css from "./attendance4.module.css";

/* which view holds which anchor the Desk and the bell reveal */
const ANCHOR_VIEW: Record<string, AttView> = { "ot-approvals": "exceptions", "pending-punches": "exceptions" };
const ALL: readonly AttView[] = ["overview", "records", "roster", "exceptions", "reports"];
const STAFF_VIEWS: readonly AttView[] = ["records", "roster"];

export function AttendancePanel({ user, go, startView }: { user: User; go: (t: TabName) => void; startView?: string }) {
  const manage = MANAGE_ROLES.includes(user.role);
  const views: readonly AttView[] = manage ? ALL : STAFF_VIEWS;
  const isView = useCallback((v: string | null): v is AttView => !!v && (views as readonly string[]).includes(v), [views]);
  const [view, setView] = useState<AttView>(() => (isView(startView ?? null) ? startView as AttView : manage ? "overview" : "records"));
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if (isView(startView ?? null)) setView(startView as AttView); }
  useTabViewAddress("Attendance", view, setView, isView);
  /* a view mounts the first time it is opened and then stays mounted, hidden
     (its filters and its place survive a switch); nothing loads before it is opened */
  const [seen, setSeen] = useState<readonly AttView[]>([view]);
  if (!seen.includes(view)) setSeen([...seen, view]);
  const on = (v: AttView) => seen.includes(v);
  const [person, setPerson] = useState<{ id: number; day: string } | null>(null);
  const [recDay, setRecDay] = useState(() => mytToday());
  const [mine, setMine] = useState<AttendanceMine | null>(null);
  const onMine = useCallback((m: AttendanceMine) => setMine(m), []);

  /* an anchor revealed from elsewhere (the Desk, the bell) opens its view first */
  useEffect(() => {
    const onReveal = (e: Event) => { const v = ANCHOR_VIEW[(e as CustomEvent<string>).detail]; if (v && manage) setView(v); };
    window.addEventListener("azone:reveal", onReveal);
    return () => window.removeEventListener("azone:reveal", onReveal);
  }, [manage]);

  const NAMES: Record<AttView, [string, string, string]> = {
    overview: [L("Overview", "Gambaran"), L("Today at a glance", "Hari ini sepintas lalu"), "overview"],
    records: [L("Attendance Records", "Rekod Kehadiran"), manage ? L("The day register, one person's day", "Daftar harian, hari seseorang") : L("Your month", "Bulan anda"), "records"],
    roster: [L("Shift Roster", "Roster Syif"), L("Expected working schedule", "Jadual kerja dijangka"), "roster"],
    exceptions: [L("Exceptions & Approvals", "Pengecualian & Kelulusan"), L("Forgotten punches and overtime", "Ketukan terlupa dan OT"), "exceptions"],
    reports: [L("Reports", "Laporan"), L("The month reconciled, exports", "Bulan diselaraskan, eksport"), "reports"],
  };
  const openPerson = (id: number, day: string) => setPerson({ id, day });
  const canExport = holds("payroll_export", ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"].includes(user.role));
  const canTemplates = ["ceo", "super_admin", "admin", "hr_admin"].includes(user.role);
  const hmOf = (ms: number) => `${Math.floor(ms / 3600000)}h ${String(Math.round((ms % 3600000) / 60000)).padStart(2, "0")}m`;
  const mineBusy = !mine || !mine.loaded;

  return (
    <TabPage className={css.page}>
      <div className="erp-desktop-only">
        <LineTabs value={view} onChange={(k) => setView(k)} tabs={views.map((v) => [v, NAMES[v][0]] as const)} label={L("Attendance", "Kehadiran")} />
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="att-view-bar">
        <ViewSwitch value={view} onChange={(k) => setView(k)} label={L("Attendance view", "Paparan kehadiran")} options={views.map((v) => [v, NAMES[v][0], NAMES[v][1]] as const)} />
      </div>

      {manage && on("overview") && (
        <div hidden={view !== "overview"} className={css.body} data-testid="att-overview">
          <AttendanceOverview user={user} open={setView} openPerson={openPerson} />
        </div>
      )}

      {on("records") && (
        <div hidden={view !== "records"} className={css.body}>
          {manage ? (
            <>
              <AttendanceRecords canExport={canExport} openPerson={openPerson} day={recDay} setDay={setRecDay} />
              {/* the month's punch log across the team (was the Team tab) - sort a column, or find one person */}
              <TabZone label={L("Month punch log", "Log ketukan bulanan")} hint={L("Every punch across the team for the month - sort a column, or find one person.", "Setiap ketukan seluruh pasukan untuk bulan ini - susun lajur, atau cari seorang.")}>
                <Attendance user={user} view="team" />
              </TabZone>
            </>
          ) : (
            <>
              <TabZone label={L("This month", "Bulan ini")}>
                <KpiRow label={L("My month", "Bulan saya")}>
                  <KpiTile icon="date" tone="gold" label={L("Days worked", "Hari bekerja")} value={mine?.days ?? 0} busy={mineBusy} sub={L("This month", "Bulan ini")} />
                  <KpiTile icon="time" tone="green" label={L("Hours", "Jam")} value={mine ? hmOf(mine.totalMs) : "—"} busy={mineBusy} sub={L("This month · clocked in", "Bulan ini · didaftar masuk")} />
                  <KpiTile icon="success" tone="navy" label={L("Average per day", "Purata sehari")} value={mine && mine.days > 0 ? hmOf(mine.totalMs / mine.days) : "—"} busy={mineBusy} sub={L("This month · per day worked", "Bulan ini · setiap hari bekerja")} />
                  <KpiTile icon="warning" tone={mine?.missingOut ? "red" : "navy"} label={L("Missing clock-out", "Tiada daftar keluar")} value={mine?.missingOut ?? 0} busy={mineBusy}
                    sub={mine?.missingOut ? L("Days before today with no clock-out", "Hari sebelum hari ini tanpa daftar keluar") : L("This month · none", "Bulan ini · tiada")} />
                </KpiRow>
              </TabZone>
              <TabZone label={L("My records", "Rekod saya")} hint={L("Your punches, hours and timesheet by month. Forgot a punch? Make it on On Shift - it waits for approval.", "Ketukan, jam dan lembaran masa anda mengikut bulan. Terlupa ketukan? Buat di On Shift - ia menunggu kelulusan.")}>
                <Attendance user={user} view="mine" onMine={onMine} />
              </TabZone>
            </>
          )}
        </div>
      )}

      {on("roster") && (
        <div hidden={view !== "roster"} className={css.body}>
          <ShiftRoster canTemplates={canTemplates} role={user.role} openPerson={manage ? openPerson : undefined} />
        </div>
      )}

      {manage && on("exceptions") && (
        <div hidden={view !== "exceptions"} className={css.body}>
          <AttendanceExceptions user={user} />
        </div>
      )}

      {manage && on("reports") && (
        <div hidden={view !== "reports"} className={css.body}>
          <AttendanceReports canExport={canExport} />
          <DailyAttendanceChart role={user.role} />
        </div>
      )}

      {manage && <PersonDayDrawer target={person} onClose={() => setPerson(null)} goExceptions={() => { setPerson(null); setView("exceptions"); }} />}
      {!manage && <p className={css.sub}>{L("Clock in and out on On Shift.", "Daftar masuk dan keluar di On Shift.")} <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={() => go("On Shift")}>{L("Open On Shift", "Buka On Shift")}</button></p>}
    </TabPage>
  );
}
