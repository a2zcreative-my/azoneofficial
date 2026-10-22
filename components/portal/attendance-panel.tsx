"use client";

/* v1.188.0 - THE ATTENDANCE PAGE, TABBED (the owner's brief and reference,
   22-10-2026): Overview · My Attendance · Team Attendance · Schedule &
   Roster · Management. One page used to stack the same cards in four zones
   (v1.173.0: Today, Waiting on me, The roster, Setup); the cards are the
   cards they were, moved under a pill row, and nothing else changed:

     Overview         the figure tiles (today's summary - the dashboard's
                      cached /staff/dashboard/summary - and the monitor's
                      own answer), the live monitor (Attendance view=
                      "monitor"), the attendance donut, quick actions, and
                      today's assignments                       MANAGE_ROLES
     My Attendance    the personal records (Attendance view="mine") everyone
     Team Attendance  the team report (Attendance view="team") and the
                      verification card                          MANAGE_ROLES
     Schedule & Roster  RosterBoard, every interaction, the #roster-board
                      anchor                                     everyone
     Management       OT approvals and the corrections / back-entry /
                      unpaid / working-hours / OT panel          MANAGE_ROLES
                      (the two cards keep their own narrower gates)

   EVERY TAB BODY STAYS MOUNTED and is hidden, never unmounted (the Sales
   page's rule, v1.123.0): a month picked, a filter set or a form half
   filled survives a look at another tab, and an anchor the Desk reveals
   (#ot-approvals, #pending-punches, #roster-board) exists at once - the
   panel hears revealAnchor's event and opens the tab that holds it. Every
   role gate is the gate page.tsx applied; the worker enforces each route. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Attendance, type AttendanceMine, type AttendanceMonitor } from "@/components/portal/attendance";
import { AttendanceTodayCard, TodayAssignmentsCard } from "@/components/portal/dashboard-cards";
import { useCachedApi } from "@/lib/cached-api";
import type { DashSummary } from "@/components/portal/dashboard";
import { AttendanceAdminPanel, RosterBoard, VerificationCard } from "@/components/portal/lazy-panels";
import { OtApprovalsCard } from "@/components/portal/live-cards";
import { L, MANAGE_ROLES, revealAnchor, type User } from "@/components/portal/page-shared";
import { SummaryStat, SummaryStrip, TabPage, TabZone } from "@/components/portal/tab-concept";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import type { TabName } from "@/lib/portal-tabs";
import { btnSm, card, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./attendance-panel.module.css";

type View = "overview" | "mine" | "team" | "roster" | "manage";
/* which tab holds which anchor the Desk and the assignments card reveal */
const ANCHOR_TAB: Record<string, View> = { "ot-approvals": "manage", "pending-punches": "manage", "roster-board": "roster" };

export function AttendancePanel({ user, go }: { user: User; go: (t: TabName) => void }) {
  const manage = MANAGE_ROLES.includes(user.role);
  const [view, setView] = useState<View>(manage ? "overview" : "mine");
  const sum = useCachedApi<DashSummary>(manage ? "/staff/dashboard/summary" : null);
  const [monitor, setMonitor] = useState<AttendanceMonitor | null>(null);
  const onMonitor = useCallback((m: AttendanceMonitor) => setMonitor(m), []);
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
    ["mine", L("My Attendance", "Kehadiran saya")],
    ...(manage ? ([["team", L("Team Attendance", "Kehadiran pasukan")]] as const) : []),
    ["roster", L("Schedule & Roster", "Jadual & roster")],
    ...(manage ? ([["manage", L("Management", "Pengurusan")]] as const) : []),
  ];

  /* the figures: on time / late / not clocked in from the summary (the
     verdicts the dashboard donut draws), still in and shifts from the
     monitor (the latest punch per person, v1.133.0) */
  const s = sum.data;
  const onTime = s?.attendance_on_time ?? null;
  const late = s?.attendance_late ?? null;
  const total = s?.staff_total ?? 0;
  const notIn = onTime != null && late != null ? Math.max(0, total - onTime - late) : null;
  const inNow = monitor ? monitor.staff.filter((x) => (x.last_type ? x.last_type === "clock_in" : Boolean(x.in_at && !x.out_at))).length : null;
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% ${L("of", "daripada")} ${total}` : undefined);
  /* the personal month: days, hours, the average and the days still
     missing a clock-out - the records card's own footer, as figures */
  const hm = (ms: number) => `${Math.floor(ms / 3600000)}h ${String(Math.round((ms % 3600000) / 60000)).padStart(2, "0")}m`;
  const mineBusy = !mine || !mine.loaded;
  const avgMs = mine && mine.days > 0 ? mine.totalMs / mine.days : 0;
  const monthLabel = mine ? new Date(`${mine.month}-01T00:00:00`).toLocaleDateString("en-MY", { month: "long", year: "numeric" }) : "";

  return (
    <TabPage className={css.page}>
      <div role="tablist" className={`erp-pill-row ${css.tabs}`}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k}
            className={view === k ? tabPillOn : tabPill} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>

      {manage && (
        <div hidden={view !== "overview"} className={css.body}>
          <TabZone label={L("Today", "Hari ini")} hint={L("Who is on time, late, not in yet and still on shift - the live monitor below names them.", "Siapa tepat waktu, lewat, belum masuk dan masih bersyif - pemantau langsung di bawah menamakan mereka.")}>
          <SummaryStrip cols={4} ariaLabel={L("Today", "Hari ini")}>
            <SummaryStat icon="success" tone="success" label={L("On time", "Tepat waktu")} value={onTime ?? 0} busy={onTime == null}
              badge={onTime != null && total > 0 ? { text: `${Math.round((onTime / total) * 100)}%`, tone: "success" } : undefined}
              hint={onTime != null ? pct(onTime) : undefined} />
            <SummaryStat icon="time" tone={late ? "warning" : "neutral"} label={L("Late", "Lewat")} value={late ?? 0} busy={late == null}
              badge={late != null && total > 0 ? { text: `${Math.round((late / total) * 100)}%`, tone: late ? "warning" : "neutral" } : undefined}
              hint={late != null ? pct(late) : undefined} />
            <SummaryStat icon="error" tone={notIn ? "danger" : "neutral"} label={L("Not clocked in", "Belum daftar masuk")} value={notIn ?? 0} busy={notIn == null}
              badge={notIn != null && total > 0 ? { text: `${Math.round((notIn / total) * 100)}%`, tone: notIn ? "danger" : "success" } : undefined}
              hint={notIn != null ? pct(notIn) : undefined} />
            <SummaryStat icon="place" tone="brand" label={L("On shift now", "Sedang syif")} value={inNow ?? 0} busy={inNow == null}
              hint={monitor ? L(`${monitor.staff.length} active staff · latest punch`, `${monitor.staff.length} kakitangan aktif · punch terkini`) : undefined}
              detail={{ label: L("Live status", "Status langsung"), onClick: () => document.getElementById("attendance-monitor")?.scrollIntoView({ behavior: "smooth", block: "start" }) }} />
          </SummaryStrip>
          <div className={css.split}>
            <div id="attendance-monitor" className={css.monitor}>
              <Attendance user={user} view="monitor" onMonitor={onMonitor} />
            </div>
            <div className={css.aside}>
              {!s ? (
                <div className={card} aria-busy="true"><SkelRows rows={3} /></div>
              ) : s.attendance_on_time == null || s.attendance_late == null ? null : (
                <AttendanceTodayCard onTime={s.attendance_on_time} late={s.attendance_late} staffTotal={s.staff_total ?? 0} />
              )}
              <div className={card}>
                <p className="erp-heading">{L("Quick actions", "Tindakan pantas")}</p>
                <div className={css.quick}>
                  <button type="button" className={`${btnSm} ${css.quickBtn}`} onClick={() => go("On Shift")}><AppIcon name="time" />{L("Clock in / out", "Daftar masuk / keluar")}</button>
                  <button type="button" className={`${btnSm} ${css.quickBtn}`} onClick={() => go("Leave")}><AppIcon name="holiday" />{L("Apply leave", "Mohon cuti")}</button>
                  <button type="button" className={`${btnSm} ${css.quickBtn}`} onClick={() => setView("roster")}><AppIcon name="date" />{L("View roster", "Lihat roster")}</button>
                  <button type="button" className={`${btnSm} ${css.quickBtn}`} onClick={() => setView("team")}><AppIcon name="documents" />{L("Team report", "Laporan pasukan")}</button>
                </div>
              </div>
            </div>
          </div>
          </TabZone>
          {/* v1.171.0 - today's assignments (from the Dashboard); status chips
              act for the roles that may edit the roster. Open roster opens
              the Schedule & Roster tab and scrolls to the board. */}
          <TabZone label={L("Assignments", "Tugasan")}>
            <TodayAssignmentsCard canManage={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)}
              onOpenRoster={() => { setView("roster"); revealAnchor("roster-board"); }} />
          </TabZone>
        </div>
      )}

      <div hidden={view !== "mine"} className={css.body}>
        <TabZone label={L("This month", "Bulan ini")} hint={monthLabel ? L(`Your ${monthLabel} - first clock-in to last clock-out, Malaysia time.`, `${monthLabel} anda - daftar masuk pertama hingga daftar keluar terakhir, waktu Malaysia.`) : undefined}>
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

      {manage && (
        <div hidden={view !== "team"} className={css.body}>
          {/* v1.84.0 (CEO: "attendance verification should move to
              Attendance ... full report is require and a must!") - the same
              tier that could see it there. It reads first: one row per
              person with the month's flags (missing punches, late, absent)
              is the issues list; the punch log under it is the evidence. */}
          {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) && (
            <TabZone label={L("Verification", "Pengesahan")} hint={L("One row per person for the month; the flags are the issues - missing clock-ins and clock-outs, late days, absences.", "Satu baris setiap orang untuk bulan ini; bendera ialah isunya - daftar masuk dan keluar yang tertinggal, hari lewat, ketidakhadiran.")}>
              <VerificationCard />
            </TabZone>
          )}
          <TabZone label={L("Punch log", "Log punch")} hint={L("Every punch across the team for the month - sort a column, or find one person.", "Setiap punch seluruh pasukan untuk bulan ini - susun lajur, atau cari seorang.")}>
            <Attendance user={user} view="team" />
          </TabZone>
        </div>
      )}

      <div hidden={view !== "roster"} className={css.body}>
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
          canDeleteTask={["ceo", "super_admin"].includes(user.role)}
        />
        </div>
        </TabZone>
      </div>

      {manage && (
        <div hidden={view !== "manage"} className={css.body}>
          <TabZone label={L("Approvals", "Kelulusan")}>
            {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? (
              <OtApprovalsCard />
            ) : (
              <PermissionPlaceholder
                title={L("OT Approvals", "Kelulusan OT")}
              />
            )}
          </TabZone>
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
