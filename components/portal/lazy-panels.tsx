"use client";

/**
 * THE TAB PANELS, LOADED WHEN THEIR TAB IS OPENED — v1.103.0 (roadmap phase 01).
 *
 * Before this file, app/portal/page.tsx imported every panel statically, so
 * the portal's one JavaScript bundle carried every tab for every person: a
 * live host opening the roster downloaded Payroll, Accounting, Purchasing,
 * the ELFIA catalogue editor and the Threads study room to get there - none
 * of which her role can open, all of which she paid for in parse time on a
 * phone. Measured on 05-09-2026: zero dynamic imports in the project;
 * role-panels.tsx alone is 308 KB of source, payroll-panel 106 KB, the roster
 * board 130 KB, the store panel 120 KB.
 *
 * Each export below is the SAME component under the SAME name, wrapped in
 * next/dynamic, so the thirty render sites in page.tsx did not change - only
 * the import lines did. Next emits one chunk per module and fetches it the
 * first time a tab needs it; the second visit is instant.
 *
 * WHAT IS NOT HERE, on purpose: anything the Dashboard draws on first paint
 * (dashboard-cards, company-monitor, side-columns, ops-map) - deferring what
 * the first screen needs would add a round-trip to the one moment that
 * matters most. And the panels written inside page.tsx itself (Dashboard,
 * Leave, Tasks, Sales, Announcements, Profile) cannot be split until they are
 * extracted into their own files; that is the housekeeping item on the
 * roadmap, not this phase.
 *
 * ssr: false because the portal page is entirely behind sign-in - at build
 * time it prerenders to PortalSkeleton and nothing else - so there is nothing
 * a server render of a panel could ever contribute except build time.
 *
 * The fallback is a skeleton (house rule #28 - never the word "Loading").
 * Module-scope component (rule #30). tests/lazy-panels.mjs holds page.tsx to
 * importing every one of these from HERE and never statically again.
 */

import dynamic from "next/dynamic";
import { SkelCard, SkelRows } from "@/components/ui/skeleton";

/** What a tab looks like for the few hundred milliseconds its chunk takes to
    arrive: a card head and a few rows, the shape every panel below settles
    into. Deliberately generic - it is on screen too briefly to be worth a
    per-panel design, and a specific-looking skeleton that then changes shape
    is worse than a plain one. */
function PanelSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true">
      <SkelCard lines={2} />
      <SkelRows rows={5} />
    </div>
  );
}

const lazy = <P extends object>(load: () => Promise<React.ComponentType<P>>) =>
  dynamic(load, { ssr: false, loading: PanelSkeleton });

/* ---- one line per panel, alphabetical by module ---- */
export const AccessReviewCard = lazy(() => import("@/components/portal/access-review-card").then((m) => m.AccessReviewCard));
export const HrAdminPanel = lazy(() => import("@/components/admin/hr-admin-panel").then((m) => m.HrAdminPanel));
export const AssetsPanel = lazy(() => import("@/components/portal/assets-panel").then((m) => m.AssetsPanel));
export const CommissionPanel = lazy(() => import("@/components/portal/commission-panels").then((m) => m.CommissionPanel));
export const AdsFundPanel = lazy(() => import("@/components/portal/commission-panels").then((m) => m.AdsFundPanel));
export const ContentPanel = lazy(() => import("@/components/portal/content-panel").then((m) => m.ContentPanel));
export const DocumentsPanel = lazy(() => import("@/components/portal/documents-panel").then((m) => m.DocumentsPanel));
export const ElfiaStorePanel = lazy(() => import("@/components/portal/elfia-store-panel").then((m) => m.ElfiaStorePanel));
export const ElfiaTrafficPanel = lazy(() => import("@/components/portal/elfia-traffic-panel").then((m) => m.ElfiaTrafficPanel));
export const CashFlowPanel = lazy(() => import("@/components/portal/finance-panels").then((m) => m.CashFlowPanel));
export const ReconciliationPanel = lazy(() => import("@/components/portal/finance-panels").then((m) => m.ReconciliationPanel));
export const GeofenceCard = lazy(() => import("@/components/portal/geofence-card").then((m) => m.GeofenceCard));
export const HotelsPanel = lazy(() => import("@/components/portal/hotels-panel").then((m) => m.HotelsPanel));
export const PayrollPanel = lazy(() => import("@/components/portal/payroll-panel").then((m) => m.PayrollPanel));
export const MyPayslip = lazy(() => import("@/components/portal/payroll-panel").then((m) => m.MyPayslip));
export const PurchasingPanel = lazy(() => import("@/components/portal/purchasing-panels").then((m) => m.PurchasingPanel));
export const AccountingPanel = lazy(() => import("@/components/portal/purchasing-panels").then((m) => m.AccountingPanel));
export const AttendanceAdminPanel = lazy(() => import("@/components/portal/role-panels").then((m) => m.AttendanceAdminPanel));
export const HrPanel = lazy(() => import("@/components/portal/role-panels").then((m) => m.HrPanel));
export const InventoryPanel = lazy(() => import("@/components/portal/role-panels").then((m) => m.InventoryPanel));
export const ClaimsPanel = lazy(() => import("@/components/portal/role-panels").then((m) => m.ClaimsPanel));
export const ExpensesPanel = lazy(() => import("@/components/portal/role-panels").then((m) => m.ExpensesPanel));
export const TikTokOrdersCard = lazy(() => import("@/components/portal/role-panels").then((m) => m.TikTokOrdersCard));
export const RosterBoard = lazy(() => import("@/components/portal/roster-board").then((m) => m.RosterBoard));
export const StokisPanel = lazy(() => import("@/components/portal/stokis-panel").then((m) => m.StokisPanel));
export const TabAccessCard = lazy(() => import("@/components/portal/tab-access-card").then((m) => m.TabAccessCard));
export const ThreadsPanel = lazy(() => import("@/components/portal/threads-panel").then((m) => m.ThreadsPanel));
export const VerificationCard = lazy(() => import("@/components/portal/verification-card").then((m) => m.VerificationCard));
export const WebOrdersPanel = lazy(() => import("@/components/portal/web-orders-panel").then((m) => m.WebOrdersPanel));
export const StaffDirectory = lazy(() => import("@/components/staff/staff-directory").then((m) => m.StaffDirectory));
