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
import { TaskProgressCard, InventoryStatusCard } from "@/components/portal/company-monitor";
/* v1.103.0 (roadmap phase 01) - every tab panel that is NOT on the first
   screen arrives through next/dynamic, one chunk per module, fetched the
   first time its tab is opened. components/portal/lazy-panels.tsx explains
   why, and tests/lazy-panels.mjs fails the build if one of them is ever
   imported statically here again. */
import {
  CompaniesPanel, AssetsPanel, CardsPanel, ContentPanel,
  DocumentsPanel, ElfiaStorePanel, ElfiaTrafficPanel, FinancePage,
  HotelsPanel, SalesMap, PayrollPanel, MyPayslip, AccountingPanel,
  AttendancePanel, HrPage, InventoryPanel, ClaimsPanel, ExpensesPanel, EcommercePanel,
  StokisPanel, ThreadsPanel,
  StaffDirectory,
} from "@/components/portal/lazy-panels";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { Announcements } from "@/components/portal/announcements";
import { Dashboard } from "@/components/portal/dashboard";
import { DeskPage } from "@/components/portal/desk-page";
import { Leave } from "@/components/portal/leave";
import { L, MANAGE_ROLES } from "@/components/portal/page-shared";
import { Profile } from "@/components/portal/profile";
import { ClientsCard, LiveEconomicsCard, PackagesEditorCard, PnlCard, Sales } from "@/components/portal/sales";
import { Tasks } from "@/components/portal/tasks";
import { UsersPanel } from "@/components/portal/users-panel";
import type { TabName } from "@/lib/portal-tabs";
import css from "./portal.module.css";

export default function PortalPage() {
  const {
    user, activeTab, lang, setTab, canOpen,
    salesStart, setSalesStart, salesCreateRequest, setSalesCreateRequest,
    tabStart, setTabStart, focus,
  } = usePortal();
  /* v1.203.0 - where a tab should open when a Dashboard quick action sent you */
  const startOf = (t: TabName) => (tabStart?.tab === t ? tabStart.view : undefined);
  /* v1.205.0 - the record a search hit, a notification or a Desk item opened;
     only the tab it belongs to receives it (lib/record-focus.ts) */
  const focusOf = (t: TabName) => (focus?.tab === t ? focus : null);

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
              {/* v1.182.1 (the owner, 22-10-2026): the "Calendar and team
                  overview" fold that followed the Dashboard is gone - the
                  calendar lives in Attendance and Leave, the team's day in
                  the Attendance monitor, and the figures are the tiles
                  above. components/portal/side-columns.tsx and
                  components/ui/mini-calendar.tsx were deleted with it. */}
              <Dashboard user={user} go={setTab} canOpen={canOpen} lang={lang}
                onCreateQuotation={() => { setSalesStart("create"); setSalesCreateRequest((n) => n + 1); setTab("Sales"); }}
                openAt={(t, view) => { setTabStart({ tab: t, view }); setTab(t); }} />
            </>
          )}
          {activeTab === "Claims" && (
            <ClaimsPanel userId={user.id} role={user.role} initialView={startOf("Claims")} focus={focusOf("Claims")} />
          )}
          {activeTab === "Finance" && (
            /* v1.219.0 - Finance 2.0 (the owner's answers, 28-10-2026): one
               page, five tabs - Overview, Transactions, Expenses,
               Reconciliation, Reports. The Expenses panel and its P&L are
               handed in unchanged and drawn on their own tab. */
            <FinancePage expenses={<ExpensesPanel reporting={<PnlCard />} />} />
          )}
          {activeTab === "Attendance" && (
            /* v1.188.0 - the page is its own tabbed panel (attendance-panel.tsx):
               Overview · My Attendance · Team Attendance · Schedule & Roster ·
               Management, the same cards under the same gates. */
            <AttendancePanel user={user} go={setTab} />
          )}
          {/* v1.172.0 - Reconciliation, Ads Fund and Purchasing retired: no
             block here, no tab in the registry, no panel in the bundle.
             v1.183.0 - Commission, Enquiries, Sales Performance, Hankei's and
             Web Orders likewise. */}
          {activeTab === "Accounting" && <AccountingPanel />}
          {activeTab === "Leave" && <Leave user={user} initialView={startOf("Leave")} focus={focusOf("Leave")} />}
          {activeTab === "Tasks" && (
            /* v1.173.0: the zones are the panel's own (tasks.tsx). */
            <Tasks user={user} progress={MANAGE_ROLES.includes(user.role) ? <TaskProgressCard /> : undefined} initialView={startOf("Tasks")} focus={focusOf("Tasks")} />
          )}
          {activeTab === "Announcements" && <Announcements user={user} focus={focusOf("Announcements")} />}
          {/* v1.40.0 (AUDIT M12): visibility is decided ONCE, in the tabs filter
              (role default + tab-access override). The extra role re-check here
              made Sales the only tab where an override granted by the CEO
              rendered a completely blank page. */}
          {activeTab === "Sales" && (
            /* v1.173.0 (tab concept): the Sales panel draws its own zones
               (the month's figures, the work, the customers); the map and
               the long view follow as two more. */
            <TabPage>
              {/* v1.214.0 - the map and the longer view are the workspace's
                  Reports tab: the same three cards, one tab instead of the
                  bottom of a long page */}
              <Sales user={user} initialView={salesStart} createRequest={salesCreateRequest} focus={focusOf("Sales")} workExtra={<DocumentsPanel bare />} customersExtra={<ClientsCard bare />}
                reports={<>
                  <TabZone label={L("This month", "Bulan ini")}>
                    <SalesMap />
                  </TabZone>
                  <TabZone label={L("The longer view", "Pandangan lebih jauh")} cols={2}>
                    <LiveEconomicsCard />
                    <PackagesEditorCard role={user.role} />
                  </TabZone>
                </>} />
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
          {/* v1.192.0 - the HR page is its own tabbed panel (hr-page.tsx):
              Overview, Reports, Calendar & Holidays, Employee Lifecycle,
              Payroll & Payslips, HR Administration. The administration gate
              (hr_admin, ceo, super_admin, admin) moved inside it, unchanged. */}
          {activeTab === "HR" && <HrPage user={user} go={setTab} canOpen={canOpen} />}
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
                /* v1.204.0 - the profile links to the modules that own the
                   records (Leave, Attendance, Payroll, Users), only where this
                   account's tab strip already shows that tab */
                go={setTab}
                canOpen={canOpen}
                recordFocus={focusOf("Staff Details")}
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
            <InventoryPanel role={user.role} focus={focusOf("Inventory")} statusCard={MANAGE_ROLES.includes(user.role) ? <InventoryStatusCard /> : undefined} />
          )}
          {activeTab === "ELFIA Store" && (
            <ElfiaStorePanel />
          )}
          {activeTab === "ELFIA Traffic" && (
            <ElfiaTrafficPanel />
          )}
          {activeTab === "Ecommerce" && (
            /* v1.185.0 - the page is its own panel (ecommerce-panel.tsx): the
               tab row, the tiles, the orders table, fulfilment, the map and
               the month's detail, with the same cards and the same gates. */
            <EcommercePanel user={user} lang={lang} go={setTab} canOpen={canOpen} />
          )}
          {/* v1.5.0: Social tab removed on the CEO's direction. */}
          {activeTab === "Assets" && <AssetsPanel focus={focusOf("Assets")} />}
          {activeTab === "Threads" && <ThreadsPanel />}
          {activeTab === "Hotels" && <HotelsPanel focus={focusOf("Hotels")} />}
          {/* v1.129.0 - the three officers' cards. TAB_ROLES draws this tab
              for ceo/coo/cco only; the panel takes the role so it can put the
              signed-in officer's own card first. */}
          {activeTab === "Cards" && <CardsPanel role={user.role} />}
          {/* v1.189.0 - the Users page is its own tabbed panel (the owner's
              brief, 22-10-2026): Overview, Staff Accounts, Customer Accounts,
              Roles & Permissions, Security & Settings. The role gates the
              page applied (Who sees what - CEO / super admin; the geofence -
              super admin / CEO / COO; role changes - super admin) moved with
              their cards into users-panel.tsx. */}
          {activeTab === "Users" && <UsersPanel role={user.role} go={setTab} />}
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
