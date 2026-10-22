"use client";

/* v1.185.0 - THE ECOMMERCE PAGE (the owner's reference, 22-10-2026): a tab
   row across the top - Overview · Orders · Products · Fulfilment ·
   Analytics · Setup - and an Overview that reads top-down: four figure
   tiles, the TikTok orders table beside the Fulfilment overview and the
   top states, the Operations map, then the month in detail (revenue, hours,
   the Sales floor). His three choices, asked first: the tab row; the tiles
   are Revenue · Orders · Delivered · To ship (there is no "pending sync"
   count in this system, and a tile must be a real figure); item names, not
   product photos. "Products" is Inventory's, so that tab opens Inventory.

   WHAT DID NOT CHANGE. Every card is the card it was: TikTokOrdersTable is
   TikTokOrdersCard's logic moved whole (tiktok-orders.tsx), FulfilmentCard,
   OpsMapCard, TikTokAnalyticsCard, ConnectionStatusCard and
   RevenueAndHoursCard are untouched. Every gate is the gate it was: the
   orders table is NOT behind the revenue gate (every Ecommerce role sees
   the tracker); the tiles, fulfilment, the map, the top states and the
   month's detail are REVENUE_ROLES; TikTok analytics is CEO / super admin.
   The tiles read /staff/revenue (the cached request the month card already
   makes) and /staff/fulfilment/summary; nothing is computed on the client
   that the server does not already state. */

import { useRef, useState } from "react";
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { REVENUE_ROLES, type RevenueData } from "@/components/portal/dashboard";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { OpsMapCard } from "@/components/portal/ops-map";
import { L, ZoneLabel, type User } from "@/components/portal/page-shared";
import { TabPage } from "@/components/portal/tab-concept";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { SYNC_ROLES, TikTokOrdersTable } from "@/components/portal/tiktok-orders";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs";
import { TopStatesCard } from "@/components/portal/top-states-card";
import { RevenueAndHoursCard } from "@/components/portal/trading-desk";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { TabName } from "@/lib/portal-tabs";
import css from "./ecommerce-panel.module.css";

type View = "overview" | "orders" | "fulfilment" | "analytics" | "setup";
interface FulfilSummary { month: string; by_status: Record<string, number>; oldest_preparing: { order_ref: string; days: number | null } | null }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const monthLabel = (ym: string, lang: Lang) => {
  const m = Number(ym.slice(5, 7)) - 1;
  const names = lang === "ms" ? MONTHS_MS : MONTHS;
  return Number.isFinite(m) && names[m] ? `${names[m]} ${ym.slice(0, 4)}` : ym;
};
/* "76% vs last month" with its arrow, or nothing when there is no last month
   to compare with (the tile then says the plain fact instead) */
const delta = (now: number, before: number): { pct: number | null; text: string } => {
  if (!before) return { pct: null, text: "" };
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: L(`${Math.abs(pct)}% vs last month`, `${Math.abs(pct)}% berbanding bulan lepas`) };
};

export function EcommercePanel({ user, lang, go, canOpen }: {
  user: User;
  lang: Lang;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
}) {
  const [view, setView] = useState<View>("overview");
  const canRevenue = REVENUE_ROLES.includes(user.role);
  const canAnalytics = ["ceo", "super_admin"].includes(user.role);
  const rev = useCachedApi<RevenueData>(canRevenue ? "/staff/revenue" : null);
  const ful = useCachedApi<FulfilSummary>(canRevenue ? "/staff/fulfilment/summary" : null, true, ["orders"]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const showMap = () => { setView("overview"); requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  const tabs: readonly (readonly [View | "products", string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["orders", L("Orders", "Pesanan")],
    ...(canOpen("Inventory") ? ([["products", L("Products", "Produk")]] as const) : []),
    ...(canRevenue ? ([["fulfilment", L("Fulfilment", "Pemenuhan")]] as const) : []),
    ...(canAnalytics ? ([["analytics", L("Analytics", "Analitik")]] as const) : []),
    ["setup", L("Setup", "Tetapan")],
  ];

  const r = rev.data;
  const f = ful.data;
  const n = (k: string) => f?.by_status[k] ?? 0;
  const monthOrders = f ? Object.values(f.by_status).reduce((a, b) => a + b, 0) : 0;
  const delivered = n("delivered");
  const toShip = n("preparing");
  const revDelta = r ? delta(r.tiktok.this_cents, r.tiktok.last_cents) : null;
  const ordDelta = r ? delta(r.tiktok.this_orders, r.tiktok.last_orders) : null;

  /* v1.191.0 - the owner's photo's tiles: a tinted well, the label with its
     period, the figure, the change against last month. The same four figures
     from the same two cached requests. */
  const period = L("This month", "Bulan ini");
  const tiles = canRevenue && (
    <KpiRow label={period}>
      <KpiTile icon="money" tone="gold" period={period}
        label={L("Sales Revenue", "Hasil Jualan")}
        value={r ? fmtRM(r.tiktok.this_cents) : 0} busy={!r}
        delta={revDelta}
        sub={r && revDelta?.pct == null ? L(`TikTok Shop · ${monthLabel(r.month, lang)}`, `TikTok Shop · ${monthLabel(r.month, lang)}`) : undefined} />
      <KpiTile icon="documents" tone="navy" period={period}
        label={L("Total Orders", "Jumlah Pesanan")}
        value={r ? r.tiktok.this_orders : 0} busy={!r}
        delta={ordDelta}
        sub={r && ordDelta?.pct == null ? L(`${r.tiktok.last_orders} last month`, `${r.tiktok.last_orders} bulan lepas`) : undefined} />
      <KpiTile icon="shipped" tone="blue" period={period}
        label={L("Delivered", "Telah Sampai")}
        value={<>{delivered} {f && monthOrders > 0 && <span className={`erp-chip erp-chip-sm erp-chip-success ${css.inline}`}>{Math.round((delivered / monthOrders) * 100)}%</span>}</>}
        busy={!f}
        sub={f ? L(`of ${monthOrders} shipments this month`, `daripada ${monthOrders} penghantaran bulan ini`) : undefined}
        onClick={() => setView("fulfilment")} title={L("See the fulfilment", "Lihat pemenuhan")} />
      <KpiTile icon="package" tone="gold" period={period}
        label={L("To Ship", "Untuk Dihantar")}
        value={<>{toShip} {f && <span className={`erp-chip erp-chip-sm ${toShip > 0 ? "erp-chip-warning" : "erp-chip-success"} ${css.inline}`}>{toShip > 0
          ? (f.oldest_preparing?.days != null ? L(`oldest ${f.oldest_preparing.days} d`, `tertua ${f.oldest_preparing.days} h`) : L("Needs action", "Perlu tindakan"))
          : L("All shipped", "Semua dihantar")}</span>}</>}
        busy={!f}
        sub={f ? L("orders still preparing", "pesanan masih disediakan") : undefined}
        onClick={() => setView("orders")} title={L("See the orders", "Lihat pesanan")} />
    </KpiRow>
  );
  const canSync = SYNC_ROLES.includes(user.role);

  return (
    <TabPage className={css.page}>
      {/* v1.191.0 - the owner's photo: underline tabs, and at the right the
          month and "Sync from TikTok" (the orders table's own sync, asked for
          by an event, so there is still one sync and one gate) */}
      <LineTabs value={view} tabs={tabs as readonly (readonly [View, string])[]} label={L("Ecommerce", "E-dagang")}
        onChange={(k) => (k === ("products" as View) ? go("Inventory") : setView(k))}
        aside={
          <TabAside>
            {r && <TabPeriod>{monthLabel(r.month, lang)}</TabPeriod>}
            {canSync && (
              <TabAction icon="refresh" onClick={() => { setView((v) => (v === "overview" || v === "orders" ? v : "overview")); window.dispatchEvent(new Event("azone:tiktok-sync")); }}>
                {L("Sync from TikTok", "Segerak dari TikTok")}
              </TabAction>
            )}
          </TabAside>
        } />

      {view === "overview" && (
        <>
          {tiles}
          <div className={`${css.work} ${canRevenue ? css.workSplit : ""}`}>
            <TikTokOrdersTable role={user.role} />
            {canRevenue && (
              <div className={css.aside}>
                <FulfilmentCard onViewAll={() => setView("fulfilment")} />
                <TopStatesCard onViewMap={showMap} />
              </div>
            )}
          </div>
          {canRevenue && (
            <div ref={mapRef} className={css.mapAnchor}>
              <OpsMapCard />
            </div>
          )}
          {canRevenue && (
            <section className="erp-stack-tight">
              <ZoneLabel>{L("This month", "Bulan ini")}</ZoneLabel>
              {/* v1.171.0: the Sales floor (KPI target, pace, markets, month
                  bars) is the card's third pill - beside the revenue it measures. */}
              <RevenueAndHoursCard user={user} go={go} lang={lang} />
            </section>
          )}
        </>
      )}
      {view === "orders" && <TikTokOrdersTable role={user.role} />}
      {view === "fulfilment" && canRevenue && (
        <div className={css.two}>
          <FulfilmentCard />
          <TopStatesCard onViewMap={showMap} />
        </div>
      )}
      {view === "analytics" && canAnalytics && <TikTokAnalyticsCard />}
      {view === "setup" && <ConnectionStatusCard />}
    </TabPage>
  );
}
