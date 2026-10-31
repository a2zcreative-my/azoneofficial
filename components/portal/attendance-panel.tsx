"use client";

/* v1.188.0 - THE ATTENDANCE PAGE, TABBED. v1.191.0 - THE OWNER'S PHOTO'S SEVEN
   TABS (22-10-2026, "should follow exactly as per previous photo shared"; he
   chose the photo's tab set over the five of his written brief):

     Overview     the photo's overview (attendance-overview.tsx): five tiles,
                  today's table, the donut and quick actions, the month strip,
                  issues and recent activity                     MANAGE_ROLES
     Attendance   your own month: its figures and your records    everyone
     On Shift     a way to the On Shift page, where the punch is made - a
                  tab of the row in the photo, the page it opens  everyone
     Roster       today's assignments and the roster board, every
                  interaction, the #roster-board anchor         everyone
                  (today's assignments: MANAGE_ROLES, as before)
     Team         OT approvals and the team's punch log          MANAGE_ROLES
     Reports      the verification report (one row a person, flags, CSV)
                                                                  MANAGE_ROLES
     Settings     corrections, manual entries, unpaid leave, working hours,
                  OT rules and the export                         MANAGE_ROLES

   The cards are the cards they were; each keeps the narrower gate it had and
   the worker enforces every route. EVERY TAB BODY STAYS MOUNTED and is hidden,
   never unmounted. An anchor the Desk reveals opens its tab first:
   #ot-approvals -> Team, #pending-punches -> Settings, #roster-board -> Roster. */

import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { useCallback, useEffect, useRef, useState } from "react";
import { Attendance, type AttendanceMine } from "@/components/portal/attendance";
import { AttendanceOverview, type OverviewTab } from "@/components/portal/attendance-overview";
import { TodayAssignmentsCard } from "@/components/portal/dashboard-cards";
import { useCachedApi } from "@/lib/cached-api";
import type { DashSummary } from "@/components/portal/dashboard";
import { AttendanceAdminPanel, RosterBoard, VerificationCard } from "@/components/portal/lazy-panels";
import { OtApprovalsCard } from "@/components/portal/live-cards";
import { L, MANAGE_ROLES, revealAnchor, type User } from "@/components/portal/page-shared";
import { SummaryStat, SummaryStrip, TabPage, TabZone } from "@/components/portal/tab-concept";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs";
import { mytToday } from "@/lib/format";
import type { TabName } from "@/lib/portal-tabs";
import css from "./attendance-panel.module.css";

type View = "overview" | "mine" | "onshift" | "roster" | "team" | "reports" | "settings";
/* which tab holds which anchor the Desk and the assignments card reveal */
const ANCHOR_TAB: Record<string, View> = { "ot-approvals": "team", "pending-punches": "settings", "roster-board": "roster" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function AttendancePanel({ user, go }: { user: User; go: (t: TabName) => void }) {
  const manage = MANAGE_ROLES.includes(user.role);
  const [view, setView] = useState<View>(manage ? "overview" : "mine");
  const sum = useCachedApi<DashSummary>(manage ? "/staff/dashboard/summary" : null);
  const [mine, setMine] = useState<AttendanceMine | null>(null);
  const onMine = useCallback((m: AttendanceMine) => setMine(m), []);
  const rosterRef = useRef<HTMLDivElement | null>(null);

  /* an anchor revealed from elsewhere (the Desk, the assignments card)
     opens its tab first; revealAnchor then finds the element visible */
  useEffect(() => {
    const onReveal = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const tab = ANCHOR_TAB[id];
      if (tab) setView(tab);
    };
    window.addEventListener("azone:reveal", onReveal);
    return () => window.removeEventListener("azone:reveal", onReveal);
  }, []);

  const tabs: readonly (readonly [View, string])[] = [
    ...(manage ? ([["overview", L("Overview", "Gambaran")]] as const) : []),
    ["mine", L("Attendance", "Kehadiran")],
    ["onshift", L("On Shift", "Syif Saya")],
    ["roster", L("Roster", "Roster")],
    ...(manage ? ([
      ["team", L("Team", "Pasukan")],
      ["reports", L("Reports", "Laporan")],
      ["settings", L("Settings", "Tetapan")],
    ] as const) : []),
  ];
  /* On Shift is a page of its own (where the punch is made): its tab opens it */
  const pick = (k: View) => (k === "onshift" ? go("On Shift") : setView(k));
  const open = useCallback((t: OverviewTab) => setView(t), []);

  /* the personal month: days, hours, the average and the days still
     missing a clock-out - the records card's own footer, as figures */
  const hm = (ms: number) => `${Math.floor(ms / 3600000)}h ${String(Math.round((ms % 3600000) / 60000)).padStart(2, "0")}m`;
  const mineBusy = !mine || !mine.loaded;
  const avgMs = mine && mine.days > 0 ? mine.totalMs / mine.days : 0;
  const monthLabel = mine ? new Date(`${mine.month}-01T00:00:00`).toLocaleDateString("en-MY", { month: "long", year: "numeric" }) : "";
  const nowMonth = (() => { const [y, m] = mytToday().split("-").map(Number) as [number, number]; return `${MONTHS[m - 1]} ${y}`; })();

  return (
    <TabPage className={css.page}>
      <LineTabs value={view} onChange={pick} tabs={tabs} label={L("Attendance", "Kehadiran")}
        aside={
          <TabAside>
            <TabPeriod>{nowMonth}</TabPeriod>
            {manage && <TabAction icon="chart" onClick={() => setView("reports")}>{L("Team report", "Laporan pasukan")}</TabAction>}
          </TabAside>
        } />

      {manage && (
        <div hidden={view !== "overview"} className={css.body}>
          <AttendanceOverview summary={sum.data} open={open} go={go} />
        </div>
      )}

      <div hidden={view !== "mine"} className={css.body}>
        <TabZone label={L("This month", "Bulan ini")} hint={monthLabel ? L(`Your ${monthLabel} - each shift from its clock-in to its clock-out, Malaysia time.`, `${monthLabel} anda - setiap syif dari daftar masuk hingga daftar keluarnya, waktu Malaysia.`) : undefined}>
          <SummaryStrip cols={4} ariaLabel={L("My month", "Bulan saya")}>
            <SummaryStat icon="date" tone="brand" label={L("Days worked", "Hari bekerja")} value={mine?.days ?? 0} busy={mineBusy} />
            <SummaryStat icon="time" tone="success" label={L("Hours", "Jam")} value={mine ? hm(mine.totalMs) : "—"} busy={mineBusy} />
            <SummaryStat icon="success" tone="neutral" label={L("Average per day", "Purata sehari")} value={mine && mine.days > 0 ? hm(avgMs) : "—"} busy={mineBusy} />
            <SummaryStat icon="warning" tone={mine?.missingOut ? "warning" : "neutral"} label={L("Missing clock-out", "Tiada daftar keluar")} value={mine?.missingOut ?? 0} busy={mineBusy}
              hint={mine?.missingOut ? L("Days before today with no clock-out", "Hari sebelum hari ini tanpa daftar keluar") : undefined} />
          </SummaryStrip>
        </TabZone>
        <TabZone label={L("My records", "Rekod saya")} hint={L("Your punches, hours and timesheet by month.", "Punch, jam dan lembaran masa anda mengikut bulan.")}>
          <Attendance user={user} view="mine" onMine={onMine} />
        </TabZone>
      </div>

      <div hidden={view !== "roster"} className={css.body}>
        {/* v1.171.0 - today's assignments; status chips act for the roles that
            may edit the roster. Open roster scrolls to the board below. */}
        {manage && (
          <TabZone label={L("Today's assignments", "Tugasan hari ini")}>
            <TodayAssignmentsCard canManage={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)}
              onOpenRoster={() => { setView("roster"); revealAnchor("roster-board"); }} />
          </TabZone>
        )}
        <TabZone label={L("Roster", "Roster")} hint={L("Shifts and tasks by week; the board is the one the Dashboard's assignments open.", "Syif dan tugasan mengikut minggu; papan ini yang dibuka oleh tugasan di Dashboard.")}>
        {/* v1.171.0: the anchor "Open roster" (assignments card) scrolls to. */}
        <div id="roster-board" className={css.rosterAnchor} ref={rosterRef}>
        <RosterBoard
          canManage={[
            "ceo",
            "coo",
            "cco",
            "hr_admin",
            "super_admin",
            "admin",
          ].includes(user.role)}
          canEdit={["ceo", "coo", "cco", "super_admin", "admin"].includes(
            user.role
          )}
          /* v1.171.0 (CEO, 20-09-2026: "on the attendance, the Task
             should be able to delete!") - mirrors task_delete in
             worker/src/permissions.ts, which is the CEO alone. */
          canDeleteTask={holds("task_delete", ["ceo", "super_admin"].includes(user.role))}
        />
        </div>
        </TabZone>
      </div>

      {manage && (
        <div hidden={view !== "team"} className={css.body}>
          <TabZone label={L("Approvals", "Kelulusan")}>
            {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? (
              <OtApprovalsCard />
            ) : (
              <PermissionPlaceholder
                title={L("OT Approvals", "Kelulusan OT")}
              />
            )}
          </TabZone>
          <TabZone label={L("Punch log", "Log punch")} hint={L("Every punch across the team for the month - sort a column, or find one person.", "Setiap punch seluruh pasukan untuk bulan ini - susun lajur, atau cari seorang.")}>
            <Attendance user={user} view="team" />
          </TabZone>
        </div>
      )}

      {manage && (
        <div hidden={view !== "reports"} className={css.body}>
          {/* v1.84.0 (CEO: "attendance verification should move to
              Attendance ... full report is require and a must!") - the same
              tier that could see it there. One row per person with the
              month's flags; Export CSV is on the card. */}
          {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) ? (
            <TabZone label={L("Team report", "Laporan pasukan")} hint={L("One row per person for the month; the flags are the issues - missing clock-ins and clock-outs, late days, absences.", "Satu baris setiap orang untuk bulan ini; bendera ialah isunya - daftar masuk dan keluar yang tertinggal, hari lewat, ketidakhadiran.")}>
              <VerificationCard />
            </TabZone>
          ) : (
            <PermissionPlaceholder title={L("Team report", "Laporan pasukan")} />
          )}
        </div>
      )}

      {manage && (
        <div hidden={view !== "settings"} className={css.body}>
          {/* v1.91.0 — mirrors attendance_correct in the worker. */}
          <TabZone label={L("Records management", "Pengurusan rekod")} hint={L("Corrections, manual entries, unpaid leave, working hours and OT rules, exports.", "Pembetulan, catatan manual, cuti tanpa gaji, waktu kerja dan peraturan OT, eksport.")}>
            {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) ? (
              <AttendanceAdminPanel role={user.role} />
            ) : (
              <PermissionPlaceholder
                title={L("Attendance Admin", "Admin Kehadiran")}
              />
            )}
          </TabZone>
        </div>
      )}
    </TabPage>
  );
}
