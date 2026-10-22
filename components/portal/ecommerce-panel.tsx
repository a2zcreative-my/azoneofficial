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
import { SummaryStat, SummaryStrip, TabPage } from "@/components/portal/tab-concept";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { TikTokOrdersTable } from "@/components/portal/tiktok-orders";
import { TopStatesCard } from "@/components/portal/top-states-card";
import { RevenueAndHoursCard } from "@/components/portal/trading-desk";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { TabName } from "@/lib/portal-tabs";
import { tabPill, tabPillOn } from "@/lib/ui-styles";
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
/* "+76% vs last month", or the plain fact when there is no last month */
const delta = (now: number, before: number): { text: string; tone: "success" | "danger" | "neutral" } => {
  if (!before) return { text: L("no figure last month", "tiada angka bulan lepas"), tone: "neutral" };
  const pct = Math.round(((now - before) / before) * 100);
  return { text: L(`${pct >= 0 ? "+" : ""}${pct}% vs last month`, `${pct >= 0 ? "+" : ""}${pct}% berbanding bulan lepas`), tone: pct >= 0 ? "success" : "danger" };
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

  const tiles = canRevenue && (
    <SummaryStrip cols={4} ariaLabel={L("This month", "Bulan ini")}>
      <SummaryStat
        icon="money" tone="brand"
        label={L("Sales revenue", "Hasil jualan")}
        value={r ? fmtRM(r.tiktok.this_cents) : 0}
        busy={!r}
        badge={revDelta ? { text: revDelta.text, tone: revDelta.tone } : undefined}
        hint={r ? L(`TikTok Shop · ${monthLabel(r.month, lang)}`, `TikTok Shop · ${monthLabel(r.month, lang)}`) : undefined}
      />
      <SummaryStat
        icon="cart" tone="brand"
        label={L("Total orders", "Jumlah pesanan")}
        value={r ? r.tiktok.this_orders : 0}
        busy={!r}
        badge={ordDelta ? { text: ordDelta.text, tone: ordDelta.tone } : undefined}
        hint={r ? L(`${r.tiktok.last_orders} last month`, `${r.tiktok.last_orders} bulan lepas`) : undefined}
      />
      <SummaryStat
        icon="success" tone="success"
        label={L("Delivered", "Telah sampai")}
        value={delivered}
        busy={!f}
        badge={f && monthOrders > 0 ? { text: `${Math.round((delivered / monthOrders) * 100)}%`, tone: "success" } : undefined}
        hint={f ? L(`of ${monthOrders} shipments this month`, `daripada ${monthOrders} penghantaran bulan ini`) : undefined}
        detail={{ label: L("See details", "Lihat butiran"), onClick: () => setView("fulfilment") }}
      />
      <SummaryStat
        icon="package" tone={toShip > 0 ? "warning" : "neutral"}
        label={L("To ship", "Untuk dihantar")}
        value={toShip}
        busy={!f}
        badge={f ? (toShip > 0
          ? { text: f.oldest_preparing?.days != null ? L(`oldest ${f.oldest_preparing.days} d`, `tertua ${f.oldest_preparing.days} h`) : L("needs action", "perlu tindakan"), tone: "warning" }
          : { text: L("all shipped", "semua dihantar"), tone: "success" }) : undefined}
        hint={f ? L("orders still preparing", "pesanan masih disediakan") : undefined}
        detail={{ label: L("See details", "Lihat butiran"), onClick: () => setView("orders") }}
      />
    </SummaryStrip>
  );

  return (
    <TabPage className={css.page}>
      <div className={css.bar}>
        <div role="tablist" className={`erp-pill-row ${css.tabs}`}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k}
              className={view === k ? tabPillOn : tabPill}
              onClick={() => (k === "products" ? go("Inventory") : setView(k))}>
              {label}
            </button>
          ))}
        </div>
        {r && <span className={`erp-chip erp-chip-neutral ${css.month}`}>{monthLabel(r.month, lang)}</span>}
      </div>

      {view === "overview" && (
        <>
          {tiles}
          <section className="erp-stack-tight">
            <ZoneLabel>{L("The work", "Kerja")}</ZoneLabel>
            <div className={`${css.work} ${canRevenue ? css.workSplit : ""}`}>
              <TikTokOrdersTable role={user.role} />
              {canRevenue && (
                <div className={css.aside}>
                  <FulfilmentCard />
                  <TopStatesCard onViewMap={showMap} />
                </div>
              )}
            </div>
          </section>
          {canRevenue && (
            <section className="erp-stack-tight" ref={mapRef}>
              <ZoneLabel>{L("The longer view", "Pandangan lebih jauh")}</ZoneLabel>
              <OpsMapCard />
            </section>
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
