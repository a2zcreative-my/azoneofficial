"use client";

/**
 * A2Z CREATIVE MARKETING — Staff Portal (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 *
 * v1.114.0 (housekeeping) — the modules moved out of this file into
 * components/portal/ (dashboard, trading-desk, events, attendance, leave,
 * tiktok-cards, tasks, announcements, sales, live-cards, profile,
 * users-panel, commission; shared types and helpers in page-shared), moved
 * verbatim. What stayed was PortalPage: auth, tabs, header, bell, bottom bar,
 * and the switch that draws each tab.
 *
 * v1.181.0 (P1.1) — AND NOW THE SHELL HAS GONE TOO. Auth, permissions, the
 * tab state, theme, language, notifications, the outbox scope and the
 * preferences live in `components/portal/portal-provider.tsx`; the rail,
 * topbar, bottom bar, More sheet and command palette live in
 * `components/portal/portal-shell.tsx`; `app/portal/layout.tsx` composes the
 * two and hands this file down as the layout's child.
 *
 * WHAT IS LEFT HERE IS THE SWITCH, and only the switch: thirty-three
 * branches off `activeTab`, moved verbatim. The navigation is still
 * `useState` — P1.1 changes no URL and no behaviour, so that the next
 * release, which does change URLs, starts from a shell that is already
 * proven. From P1.2 each branch becomes its own route file and this file
 * becomes the Dashboard's.
 *
 * tests/portal-split.mjs keeps this file a single component;
 * tests/lib/portal-source.mjs lets the other guards read the portal as the
 * one text it used to be.
 */

import { Fragment } from "react";
import { usePortal } from "@/components/portal/portal-provider";
import { InstallCoach } from "@/components/ui/install-coach";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { ContextPanel, RightRail } from "@/components/portal/side-columns";
import { TaskProgressCard, InventoryStatusCard } from "@/components/portal/company-monitor";
import { OpsMapCard } from "@/components/portal/ops-map";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
/* v1.103.0 (roadmap phase 01) - every tab panel that is NOT on the first
   screen arrives through next/dynamic, one chunk per module, fetched the
   first time its tab is opened. components/portal/lazy-panels.tsx explains
   why, and tests/lazy-panels.mjs fails the build if one of them is ever
   imported statically here again. */
import {
  AccessReviewCard, CompaniesPanel, HrAdminPanel, AssetsPanel, CardsPanel, CommissionPanel, ContentPanel,
  DocumentsPanel, ElfiaStorePanel, ElfiaTrafficPanel, CashFlowPanel,
  GeofenceCard, HotelsPanel, EnquiriesPanel, SalesPerformancePanel, HankeisPanel, SalesMap, PayrollPanel, MyPayslip, AccountingPanel,
  AttendanceAdminPanel, HrPanel, InventoryPanel, ClaimsPanel, ExpensesPanel, TikTokOrdersCard,
  RosterBoard, StokisPanel, TabAccessCard, ThreadsPanel, VerificationCard, WebOrdersPanel,
  StaffDirectory,
} from "@/components/portal/lazy-panels";
import { card } from "@/lib/ui-styles";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { Announcements } from "@/components/portal/announcements";
import { Attendance } from "@/components/portal/attendance";
import { LeaderboardCard, MoneyCard } from "@/components/portal/commission";
import { Dashboard, REVENUE_ROLES } from "@/components/portal/dashboard";
import { DeskPage } from "@/components/portal/desk-page";
import { Leave } from "@/components/portal/leave";
import { OtApprovalsCard } from "@/components/portal/live-cards";
import { L, MANAGE_ROLES, ZoneLabel } from "@/components/portal/page-shared";
import { Profile } from "@/components/portal/profile";
import { ClientsCard, LiveEconomicsCard, PackagesEditorCard, PnlCard, Sales } from "@/components/portal/sales";
import { Tasks } from "@/components/portal/tasks";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { RevenueAndHoursCard } from "@/components/portal/trading-desk";
import { CompanyAttendanceToday } from "@/components/portal/dashboard-cards";
import { UsersPanel } from "@/components/portal/users-panel";
import type { TabName } from "@/lib/portal-tabs";
import css from "./portal.module.css";

export default function PortalPage() {
  const {
    user, activeTab, lang, setTab, canOpen,
    salesStart, setSalesStart, salesCreateRequest, setSalesCreateRequest,
    spPreset, setSpPreset,
  } = usePortal();

  return (
    <>
          {activeTab === "Companies" && <CompaniesPanel />}
          {activeTab === "On Shift" && (
            <Dashboard user={user} go={setTab} canOpen={canOpen} lang={lang} shiftOnly />
          )}
        {/* v1.176.0 — THE DESK IS A PAGE. It was a bottom-bar stop that
            scrolled this Dashboard to a zone, so the header named the wrong
            place. Same data, its own destination. */}
        {activeTab === "Desk" && <DeskPage user={user} go={(t) => setTab(t as TabName)} />}
          {activeTab === "Dashboard" && (
            <>
              {/* v1.105.0 - iPhone + Safari + not installed, once: how to put
                  the portal on the Home Screen. Phones only (md:hidden). */}
              <div className={`${css.coach} erp-phone-only`}><InstallCoach /></div>
              <Dashboard user={user} go={setTab} canOpen={canOpen} lang={lang}
                onCreateQuotation={() => { setSalesStart("create"); setSalesCreateRequest((n) => n + 1); setTab("Sales"); }} />
              <details className={css.overview}>
                <summary className={css.overviewSummary}>
                  {L("Calendar and team overview", "Kalendar dan ringkasan pasukan")}
                </summary>
                <div className={css.overviewGrid}>
                  <div className={css.overviewCol}><ContextPanel lang={lang} /></div>
                  <div className={css.overviewCol}><RightRail lang={lang} go={(t) => setTab(t as TabName)} /></div>
                </div>
              </details>
            </>
          )}
          {activeTab === "Claims" && (
            <ClaimsPanel userId={user.id} role={user.role} />
          )}
          {activeTab === "Finance" && (
            /* v1.173.0 (tab concept): two zones. The cash position and the
               month's figures first, the payments due and the expense
               records under them; the P&L rides inside Expenses as before. */
            <TabPage>
              <TabZone label={L("This month", "Bulan ini")}>
                {/* Current cash and payments due precede reporting. */}
                <CashFlowPanel />
              </TabZone>
              {/* the expense zones are the panel's own (role-panels.tsx) */}
              <ExpensesPanel reporting={<PnlCard />} />
            </TabPage>
          )}
          {activeTab === "Attendance" && (
            /* v1.173.0 (tab concept): four zones in the v1.171.0 order -
               today's records, the decisions waiting, the roster, setup. */
            <TabPage>
              <TabZone label={L("Today", "Hari ini")}>
              <Attendance user={user} />
              {/* v1.171.0 (CEO, 20-09-2026: "resort it based on it own
                  function and properly put in on their own tabs") — the
                  attendance donut and today's assignments, from the Dashboard.
                  Same tier as the monitor above; status chips act for the
                  roles that may edit the roster. */}
              {MANAGE_ROLES.includes(user.role) && (
                <CompanyAttendanceToday canManage={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)} />
              )}
              </TabZone>
              <TabZone label={L("Waiting on me", "Menunggu saya")}>
              {/* v1.84.0 (CEO: "attendance verification should move to
                  Attendance ... full report is require and a must!") — it was
                  on the HR tab, printing every punch in the month with no
                  total. Same tier that could see it there. */}
              {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) && (
                <VerificationCard />
              )}
              {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? (
                <OtApprovalsCard />
              ) : (
                <PermissionPlaceholder
                  title={L("OT Approvals", "Kelulusan OT")}
                />
              )}
              </TabZone>
              <TabZone label={L("The roster", "Jadual")}>
              {/* Scheduling follows attendance review and OT decisions.
                  v1.171.0: the anchor "Open roster" (assignments card) scrolls to. */}
              <div id="roster-board" className={css.rosterAnchor}>
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
                /* v1.159.9 - a Sales-duty note opens the register on that
                   person and day; offered only when this account has the tab. */
                onOpenRegister={canOpen("Sales Performance") ? (staff, day) => { setSpPreset({ staff, day }); setTab("Sales Performance"); } : undefined}
              />
              </div>
              </TabZone>
              <TabZone label={L("Setup", "Tetapan")}>
              {/* v1.91.0 — mirrors attendance_correct in the worker. */}
              {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) ? (
                <AttendanceAdminPanel role={user.role} />
              ) : (
                <PermissionPlaceholder
                  title={L("Attendance Admin", "Admin Kehadiran")}
                />
              )}
              </TabZone>
            </TabPage>
          )}
          {/* v1.172.0 - Reconciliation, Ads Fund and Purchasing retired: no
             block here, no tab in the registry, no panel in the bundle. */}
          {activeTab === "Commission" && (
            <CommissionPanel
              canDecide={["super_admin", "ceo"].includes(user.role)}
            />
          )}
          {activeTab === "Accounting" && <AccountingPanel />}
          {activeTab === "Leave" && <Leave user={user} />}
          {activeTab === "Tasks" && (
            /* v1.173.0: the zones are the panel's own (tasks.tsx). */
            <Tasks user={user} progress={MANAGE_ROLES.includes(user.role) ? <TaskProgressCard /> : undefined} />
          )}
          {activeTab === "Announcements" && <Announcements user={user} />}
          {/* v1.40.0 (AUDIT M12): visibility is decided ONCE, in the tabs filter
              (role default + tab-access override). The extra role re-check here
              made Sales the only tab where an override granted by the CEO
              rendered a completely blank page. */}
          {/* v1.112.0: enquiries are their own tab (CEO: staff work that must
              be answered), one place after Sales. */}
          {activeTab === "Enquiries" && <EnquiriesPanel userId={user.id} />}
          {activeTab === "Sales" && (
            /* v1.173.0 (tab concept): the Sales panel draws its own zones
               (the month's figures, the work, the customers); the map and
               the long view follow as two more. */
            <TabPage>
              <Sales user={user} initialView={salesStart} createRequest={salesCreateRequest} workExtra={<DocumentsPanel bare />} customersExtra={<ClientsCard bare />} />
              <TabZone label={L("This month", "Bulan ini")}>
                <SalesMap />
              </TabZone>
              <TabZone label={L("The longer view", "Pandangan lebih jauh")} cols={2}>
                <LiveEconomicsCard />
                <PackagesEditorCard role={user.role} />
              </TabZone>
            </TabPage>
          )}
          {/* v1.21.0: the Pipeline tab is retired (CEO: "Sales pipeline is
            really needed?? I dont think so"). Customer enquiries — the real
            inbound funnel — moved onto the Sales tab above. */}
          {activeTab === "Content" && (
            <ContentPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
                "editor",
                "live_host",
              ].includes(user.role)}
            />
          )}
          {activeTab === "Stokis" && (
            <StokisPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
              ].includes(user.role)}
            />
          )}
          {activeTab === "HR" && (
            /* v1.173.0: the zones are the panel's own (role-panels.tsx HrPanel). */
            <TabPage>
              <HrPanel administration={["hr_admin", "ceo", "super_admin", "admin"].includes(
                user.role
              ) ? (
                <HrAdminPanel />
              ) : (
                <PermissionPlaceholder
                  title={L("HR Administration", "Pentadbiran HR")}
                />
              )} />
            </TabPage>
          )}
          {activeTab === "Payroll" && <PayrollPanel role={user.role} />}
          {activeTab === "Staff Details" && (
            /* v1.173.0: the zones are the panel's own (staff-directory.tsx). */
            <TabPage>
              <StaffDirectory
                canAmend={["super_admin", "admin", "ceo"].includes(user.role)}
                readOnly={["coo", "cco"].includes(user.role)}
                /* v1.101.0 - the organisation view needs to know who is
                   looking: only the CEO, COO and CCO may set a reporting
                   line. readOnly above is about staff RECORDS - the COO and
                   CCO may not amend those, and may set reporting lines - so
                   the two cannot be folded into one flag. */
                role={user.role}
                /* v1.174.0 - who writes roles and responsibilities: the CEO
                   and the HR tier, mirroring PERMS.responsibilities_edit in
                   worker/src/permissions.ts (tests/staff-responsibilities.mjs
                   holds the two lists equal). */
                canEditResponsibilities={["super_admin", "admin", "hr_admin", "ceo"].includes(user.role)}
              />
              {/* v1.19.0 C1: the Birthdays tab folded in here; v1.93.0 (CEO:
                  "the birthday should be embedded into the staff card!") — and
                  then into the record itself: a cake on the face within a
                  fortnight, the age they turn on the open card, and the next
                  three under the circle. The date is set on the record form. */}
            </TabPage>
          )}
          {activeTab === "Inventory" && (
            /* v1.21.1 (CEO): status strip FIRST, minimal - the health read
               before the table. v1.119.0: the panel draws it, beside the
               ELFIA bridge pulse, as the first row of its STOCK NOW zone. */
            <InventoryPanel role={user.role} statusCard={MANAGE_ROLES.includes(user.role) ? <InventoryStatusCard /> : undefined} />
          )}
          {activeTab === "ELFIA Store" && (
            <ElfiaStorePanel />
          )}
          {activeTab === "Web Orders" && (
            <WebOrdersPanel />
          )}
          {activeTab === "ELFIA Traffic" && (
            <ElfiaTrafficPanel />
          )}
          {activeTab === "Ecommerce" && (
            /* v1.174.1 - TabPage (block flow), not the .ecomStack grid: a grid
               with an implicit auto track is sized by its widest card, so ONE
               card with an unbreakable line widened every zone past the phone
               (the CEO's screenshot, 21-09-2026). In block flow a wide line
               spills out of its own card only. */
            <TabPage>
              {REVENUE_ROLES.includes(user.role) && (
                <section className="erp-stack-tight">
                  <ZoneLabel>{L("This month", "Bulan ini")}</ZoneLabel>
                  {/* v1.171.0: the Sales floor (KPI target, pace, markets,
                      month bars) is the card's third pill - moved here from
                      the Dashboard, beside the revenue it measures. */}
                  <RevenueAndHoursCard user={user} go={setTab} lang={lang} />
                </section>
              )}
              <section className="erp-stack-tight">
                <ZoneLabel>{L("The work", "Kerja")}</ZoneLabel>
                <div className={`${css.ecomWork} ${REVENUE_ROLES.includes(user.role) ? css.ecomWorkSplit : ""}`}>
                  <TikTokOrdersCard
                    role={user.role}
                    onChanged={() => {
                      /* stock views live on Inventory */
                    }}
                  />
                  {REVENUE_ROLES.includes(user.role) && <FulfilmentCard />}
                </div>
              </section>
              {REVENUE_ROLES.includes(user.role) && (
                <section className="erp-stack-tight">
                  <ZoneLabel>{L("The longer view", "Pandangan lebih jauh")}</ZoneLabel>
                  <OpsMapCard aside={<LeaderboardCard user={user} compact />} />
                  <MoneyCard user={user} />
                  {["ceo", "super_admin"].includes(user.role) && <TikTokAnalyticsCard />}
                </section>
              )}
              <section className="erp-stack-tight">
                <ZoneLabel>{L("Setup", "Tetapan")}</ZoneLabel>
                <ConnectionStatusCard />
              </section>
            </TabPage>
          )}
          {/* v1.5.0: Social tab removed on the CEO's direction. */}
          {activeTab === "Assets" && <AssetsPanel />}
          {activeTab === "Threads" && <ThreadsPanel />}
          {activeTab === "Hotels" && <HotelsPanel />}
          {/* v1.155.0 - the Sales Performance command centre: one page, evidence in, verified figures out. */}
          {activeTab === "Sales Performance" && <SalesPerformancePanel go={(t) => setTab(t as TabName)} canOpen={canOpen} preset={spPreset} />}
          {/* Hankei's Commerce: orders, receipts and manual bank verification. */}
          {activeTab === "Hankeis" && <HankeisPanel />}
          {/* v1.129.0 - the three officers' cards. TAB_ROLES draws this tab
              for ceo/coo/cco only; the panel takes the role so it can put the
              signed-in officer's own card first. */}
          {activeTab === "Cards" && <CardsPanel role={user.role} />}
          {activeTab === "Users" && (
            /* v1.173.0 (tab concept): accounts and their review in one card
               under ACCOUNTS; who sees which tab and where a punch counts
               side by side under ACCESS AND LOCATIONS. Same order as before. */
            <TabPage>
              <TabZone label={L("Accounts", "Akaun")}>
                <div className={card}>
                  <UsersPanel role={user.role} embedded />
                  {["ceo", "super_admin"].includes(user.role) && <AccessReviewCard embedded />}
                </div>
              </TabZone>
              {["ceo", "super_admin", "coo"].includes(user.role) && (
                <TabZone label={L("Access and locations", "Akses dan lokasi")} cols={2}>
                  {["ceo", "super_admin"].includes(user.role) && <TabAccessCard />}
                  {["super_admin", "ceo", "coo"].includes(user.role) && (
                    <GeofenceCard />
                  )}
                </TabZone>
              )}
            </TabPage>
          )}
          {activeTab === "Profile" && (
            /* v1.173.0 (tab concept): three zones - who I am, my pay, my
               security - in the order the tab has always read. */
            <TabPage>
              <TabZone label={L("My details", "Butiran saya")}>
                <Profile />
              </TabZone>
              <TabZone label={L("My pay", "Gaji saya")}>
                <MyPayslip />
              </TabZone>
              <TabZone label={L("Security and privacy", "Keselamatan dan privasi")}>
              <TwoFactorPanel />
              {/* v1.4.191: staff read how their personal data (NRIC, bank,
                photos, payroll) is handled — PDPA notice */}
              <p className={css.privacyNote}>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L(
                    "How your personal data is handled — Privacy Notice (PDPA)",
                    "Bagaimana data peribadi anda diurus — Notis Privasi (PDPA)"
                  )}
                </a>
              </p>
              </TabZone>
            </TabPage>
          )}
    </>
  );
}
