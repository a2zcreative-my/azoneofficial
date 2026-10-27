"use client";

/* v1.212.0 - THE ECOMMERCE PAGE, WEB AND PHONE (the owner's brief
   "A2Z OS - PREMIUM ECOMMERCE WEB & MOBILE PWA REDESIGN", 26-10-2026, and
   his four answers to the audit before it: build as proposed; one shared
   TikTok status mapping; a paged TikTok read; fulfilment counts TikTok
   orders only).

   Six tabs, one record each:
     Overview            the month's figures (labelled), what needs attention,
                         the newest orders and the month's fulfilment
     Orders              every TikTok order, paged by the server, searchable,
                         one order view (a panel; the whole screen on a phone)
     Fulfilment          where every order is now, lane by lane
     Stock & Products    the Inventory list read here (change it in Inventory)
     Analytics           states, the map, the month in detail, products,
                         and TikTok's own analytics for the CEO
     Sync & Integration  the sync, its last result, the connection, and the
                         orders that moved no stock

   ONE ORDER RECORD. Every view reads postage_records through the same
   server reads (tiktok-orders.tsx). ONE STOCK SOURCE: Inventory's own
   reads. CONSISTENT SALES: the tiles are /staff/revenue's figures and the
   fulfilment card's counts, both TikTok orders by the month recorded.
   ZERO DUPLICATION: one sync (useTikTokSync), pressed from the header or
   the Sync tab; nothing here writes an order, a stock movement or a sale.

   GATES. The same as before: the orders are not behind the revenue gate;
   the tiles, the fulfilment card, the states, the map and the month's
   detail are REVENUE_ROLES; TikTok analytics is CEO / super admin; Stock &
   Products shows when the role can open Inventory; the sync button is
   SYNC_ROLES (the server's sync_manage decides); the setup wording is
   TECH_ROLES. No figure or product from the mockup is used. */

import { useRef, useState } from "react";
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { REVENUE_ROLES, type RevenueData } from "@/components/portal/dashboard";
import { ProductPerformance, StockProducts, useStockReads } from "@/components/portal/ecommerce-stock";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { OpsMapCard } from "@/components/portal/ops-map";
import { L, ZoneLabel, type User } from "@/components/portal/page-shared";
import { TabPage } from "@/components/portal/tab-concept";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { STATUSES, TikTokOrders, connectionLine, useOrderCounts, useTikTokSync, type SyncResult } from "@/components/portal/tiktok-orders";
import { TopStatesCard } from "@/components/portal/top-states-card";
import { RevenueAndHoursCard } from "@/components/portal/trading-desk";
import { AppIcon, PanelTitle, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs";
import { useCachedApi } from "@/lib/cached-api";
import { dmyMYT, fmtRM } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { TabName } from "@/lib/portal-tabs";
import { btnSm, btnSmPrimary, card } from "@/lib/ui-styles";
import css from "./ecommerce-panel.module.css";

type View = "overview" | "orders" | "fulfilment" | "stock" | "analytics" | "sync";
interface FulfilSummary { month: string; by_status: Record<string, number>; oldest_preparing: { order_ref: string; days: number | null } | null }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const monthLabel = (ym: string, lang: Lang) => {
  const m = Number(ym.slice(5, 7)) - 1;
  const names = lang === "ms" ? MONTHS_MS : MONTHS;
  return Number.isFinite(m) && names[m] ? `${names[m]} ${ym.slice(0, 4)}` : ym;
};
/* "76% vs last month" with its arrow, or nothing when there is no last month */
const delta = (now: number, before: number): { pct: number | null; text: string } => {
  if (!before) return { pct: null, text: "" };
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: L(`${Math.abs(pct)}% vs last month`, `${Math.abs(pct)}% berbanding bulan lepas`) };
};
const timeMYT = (ms: number) => dmyMYT(new Date(ms).toISOString());

/* the sync's last answer, said the same way wherever it shows */
function syncSummary(r: SyncResult): string {
  if (!r.ok) return r.message;
  const parts = [
    L(`${r.imported} new order${r.imported === 1 ? "" : "s"} imported`, `${r.imported} pesanan baharu diimport`),
    L(`${r.skipped} already here`, `${r.skipped} sudah ada`),
  ];
  if (r.problems.length) parts.push(L(`${r.problems.length} need${r.problems.length === 1 ? "s" : ""} attention`, `${r.problems.length} perlu perhatian`));
  return parts.join(" · ");
}

export function EcommercePanel({ user, lang, go, canOpen }: {
  user: User;
  lang: Lang;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
}) {
  const [view, setView] = useState<View>("overview");
  const [ordersStatus, setOrdersStatus] = useState("");
  const [lane, setLane] = useState("preparing");
  const canRevenue = REVENUE_ROLES.includes(user.role);
  const canAnalytics = ["ceo", "super_admin"].includes(user.role);
  const canStock = canOpen("Inventory");
  const rev = useCachedApi<RevenueData>(canRevenue ? "/staff/revenue" : null);
  const ful = useCachedApi<FulfilSummary>(canRevenue ? "/staff/fulfilment/summary" : null, true, ["orders"]);
  const tt = useTikTokSync(user.role);
  const orderCounts = useOrderCounts();
  const stock = useStockReads(canStock);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const showMap = () => { setView("analytics"); requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const openOrders = (status = "") => { setOrdersStatus(status); setView("orders"); };
  const reloadKey = tt.result?.ok ? tt.result.at : 0;

  const tabs: readonly (readonly [View, string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["orders", L("Orders", "Pesanan")],
    ["fulfilment", L("Fulfilment", "Pemenuhan")],
    ...(canStock ? ([["stock", L("Stock & Products", "Stok & Produk")]] as const) : []),
    ...(canRevenue || canAnalytics ? ([["analytics", L("Analytics", "Analitik")]] as const) : []),
    ["sync", L("Sync & Integration", "Segerak & Integrasi")],
  ];

  const r = rev.data;
  const f = ful.data;
  const n = (k: string) => f?.by_status[k] ?? 0;
  const monthOrders = f ? Object.values(f.by_status).reduce((a, b) => a + b, 0) : 0;
  const delivered = n("delivered");
  const toShip = n("preparing");
  const revDelta = r ? delta(r.tiktok.this_cents, r.tiktok.last_cents) : null;
  const ordDelta = r ? delta(r.tiktok.this_orders, r.tiktok.last_orders) : null;

  /* the month's four figures, each with its period and what it counts */
  const period = L("This month", "Bulan ini");
  const tiles = canRevenue && (
    <div className={css.tiles}>
      <p className={css.tilesPeriod}>{r ? `${period} · ${monthLabel(r.month, lang)}` : period}</p>
      <KpiRow label={period}>
        <KpiTile icon="money" tone="gold" period={period}
          label={L("TikTok sales", "Jualan TikTok")}
          value={r ? fmtRM(r.tiktok.this_cents) : 0} busy={!r}
          delta={revDelta}
          sub={L("Order totals · returned & cancelled excluded", "Jumlah pesanan · dipulang & dibatal dikecualikan")} />
        <KpiTile icon="documents" tone="navy" period={period}
          label={L("Orders", "Pesanan")}
          value={r ? r.tiktok.this_orders : 0} busy={!r}
          delta={ordDelta}
          sub={r && ordDelta?.pct == null ? L(`${r.tiktok.last_orders} last month`, `${r.tiktok.last_orders} bulan lepas`) : L("TikTok, by date recorded", "TikTok, ikut tarikh direkod")}
          onClick={() => openOrders()} title={L("See the orders", "Lihat pesanan")} />
        <KpiTile icon="shipped" tone="blue" period={period}
          label={L("Delivered", "Telah Sampai")}
          value={<>{delivered} {f && monthOrders > 0 && <span className={`erp-chip erp-chip-sm erp-chip-success ${css.inline}`}>{Math.round((delivered / monthOrders) * 100)}%</span>}</>}
          busy={!f}
          sub={f ? L(`of ${monthOrders} TikTok orders this month`, `daripada ${monthOrders} pesanan TikTok bulan ini`) : undefined}
          onClick={() => { setLane("delivered"); setView("fulfilment"); }} title={L("See the fulfilment", "Lihat pemenuhan")} />
        <KpiTile icon="package" tone="gold" period={period}
          label={L("To ship", "Untuk dihantar")}
          value={<>{toShip} {f && <span className={`erp-chip erp-chip-sm ${toShip > 0 ? "erp-chip-warning" : "erp-chip-success"} ${css.inline}`}>{toShip > 0
            ? (f.oldest_preparing?.days != null ? L(`oldest ${f.oldest_preparing.days} d`, `tertua ${f.oldest_preparing.days} h`) : L("Needs action", "Perlu tindakan"))
            : L("All shipped", "Semua dihantar")}</span>}</>}
          busy={!f}
          sub={f ? L("still preparing", "masih disediakan") : undefined}
          onClick={() => { setLane("preparing"); setView("fulfilment"); }} title={L("See what is waiting", "Lihat yang menunggu")} />
      </KpiRow>
    </div>
  );

  /* what needs a person: each line says what it is and opens where it is */
  const conn = connectionLine(tt.status, tt.technical);
  const alerts: { key: string; icon: AppIconName; tone: "warn" | "bad" | "info"; text: string; to: () => void; cta: string }[] = [];
  const oc = orderCounts.counts;
  if (oc && (oc.preparing ?? 0) > 0) alerts.push({ key: "prep", icon: "package", tone: "warn",
    text: L(`${oc.preparing} order${oc.preparing === 1 ? "" : "s"} preparing - not shipped yet${f?.oldest_preparing?.days ? ` (oldest ${f.oldest_preparing.days} days)` : ""}`, `${oc.preparing} pesanan disediakan - belum dihantar${f?.oldest_preparing?.days ? ` (tertua ${f.oldest_preparing.days} hari)` : ""}`),
    to: () => { setLane("preparing"); setView("fulfilment"); }, cta: L("See them", "Lihat") });
  if (oc && (oc.no_stock ?? 0) > 0) alerts.push({ key: "nostock", icon: "warning", tone: "warn",
    text: L(`${oc.no_stock} order${oc.no_stock === 1 ? "" : "s"} moved no stock - an item not matched to a SKU, or short when it arrived`, `${oc.no_stock} pesanan tidak menggerakkan stok - barang tidak sepadan dengan SKU, atau tidak cukup semasa tiba`),
    to: () => setView("sync"), cta: L("Review", "Semak") });
  const items = stock.inv.data?.items ?? [];
  const outN = items.filter((i) => i.status === "out_of_stock").length;
  const lowN = items.filter((i) => i.status === "low").length;
  if (canStock && outN > 0) alerts.push({ key: "out", icon: "blocked", tone: "bad", text: L(`${outN} item${outN === 1 ? "" : "s"} out of stock`, `${outN} barang habis stok`), to: () => setView("stock"), cta: L("Stock", "Stok") });
  if (canStock && lowN > 0) alerts.push({ key: "low", icon: "inventory", tone: "warn", text: L(`${lowN} item${lowN === 1 ? "" : "s"} low (5 or fewer on hand)`, `${lowN} barang rendah (5 atau kurang)`), to: () => setView("stock"), cta: L("Stock", "Stok") });
  if (tt.statusLoaded && conn.tone !== "ok") alerts.push({ key: "conn", icon: "connection", tone: conn.tone === "bad" ? "bad" : "warn", text: conn.text, to: () => setView("sync"), cta: L("Details", "Butiran") });
  if (tt.result && !tt.result.ok) alerts.push({ key: "sync", icon: "error", tone: "bad", text: tt.result.message, to: () => setView("sync"), cta: L("Details", "Butiran") });
  const alertsLoaded = oc != null && tt.statusLoaded && (!canStock || stock.inv.data != null || stock.inv.failed);

  const alertCard = (
    <section className={card} aria-label={L("Needs attention", "Perlu perhatian")}>
      <PanelTitle icon="warning">{L("Needs attention", "Perlu perhatian")}</PanelTitle>
      {!alertsLoaded && alerts.length === 0 ? <p className="erp-meta">…</p>
        : alerts.length === 0 ? <p className={css.allClear}><AppIcon name="success" />{L("Nothing needs attention right now.", "Tiada yang perlu perhatian sekarang.")}</p>
        : (
          <ul className={css.alerts}>
            {alerts.map((a) => (
              <li key={a.key} className={a.tone === "bad" ? css.alertBad : a.tone === "warn" ? css.alertWarn : css.alertInfo}>
                <AppIcon name={a.icon} />
                <span className={css.alertText}>{a.text}</span>
                <button type="button" className={btnSm} onClick={a.to}>{a.cta}</button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );

  /* where every TikTok order is now (all time), lane by lane */
  const lanes = (
    <div className={css.lanes} role="tablist" aria-label={L("Fulfilment status", "Status pemenuhan")}>
      {STATUSES.map(([k, en, ms, chip]) => (
        <button key={k} type="button" role="tab" aria-selected={lane === k} className={`${css.lane} ${lane === k ? css.laneOn : ""}`} onClick={() => setLane(k)}>
          <span className={`erp-chip erp-chip-sm ${chip}`}>{L(en, ms)}</span>
          <span className={css.laneCount}>{oc ? oc[k] ?? 0 : "…"}</span>
        </button>
      ))}
    </div>
  );

  return (
    <TabPage className={css.page}>
      <LineTabs value={view} tabs={tabs} label={L("Ecommerce", "E-dagang")}
        onChange={(k) => { if (k === "orders") setOrdersStatus(""); setView(k); }}
        aside={
          <TabAside>
            {r && <TabPeriod>{monthLabel(r.month, lang)}</TabPeriod>}
            {tt.canSync && (
              <TabAction icon="refresh" onClick={() => void tt.sync()}>
                {tt.busy ? L("Syncing…", "Menyegerak…") : L("Sync from TikTok", "Segerak dari TikTok")}
              </TabAction>
            )}
          </TabAside>
        } />

      {(tt.busy || tt.result) && (
        <p className={`erp-note ${tt.busy ? "erp-note-info" : tt.result?.ok ? (tt.result.problems.length ? "erp-note-warning" : "erp-note-success") : "erp-note-warning"} ${css.syncNote}`} role="status">
          <AppIcon name={tt.busy ? "refresh" : tt.result?.ok ? "success" : "warning"} />
          <span>{tt.busy ? L("Syncing from TikTok…", "Menyegerak dari TikTok…") : tt.result ? `${L("Sync", "Segerak")} ${timeMYT(tt.result.at)}: ${syncSummary(tt.result)}` : ""}</span>
          {!tt.busy && view !== "sync" && <button type="button" className={btnSm} onClick={() => setView("sync")}>{L("Details", "Butiran")}</button>}
        </p>
      )}

      {view === "overview" && (
        <>
          {tiles}
          <div className={css.overviewGrid}>
            {alertCard}
            {canRevenue && <FulfilmentCard onViewAll={() => setView("fulfilment")} />}
          </div>
          <TikTokOrders mode="recent" title={L("Recent orders", "Pesanan terkini")} onViewAll={() => openOrders()} reloadKey={reloadKey} />
        </>
      )}

      {view === "orders" && <TikTokOrders key={`orders-${ordersStatus}`} mode="full" initialStatus={ordersStatus} reloadKey={reloadKey} />}

      {view === "fulfilment" && (
        <>
          <section className={card} aria-label={L("Fulfilment", "Pemenuhan")}>
            <PanelTitle icon="fulfilment">{L("Where every TikTok order is now", "Di mana setiap pesanan TikTok sekarang")}</PanelTitle>
            <p className="erp-meta">{L("All TikTok orders, by their status today. Statuses come from TikTok through the live updates and Sync.", "Semua pesanan TikTok, mengikut status hari ini. Status datang dari TikTok melalui kemas kini langsung dan Segerak.")}</p>
            {lanes}
          </section>
          <TikTokOrders key={`lane-${lane}`} mode="full" initialStatus={lane} pills={false} reloadKey={reloadKey}
            title={L(`${STATUSES.find((s) => s[0] === lane)?.[1] ?? ""} orders`, `Pesanan ${STATUSES.find((s) => s[0] === lane)?.[2] ?? ""}`)} />
          {canRevenue && <FulfilmentCard />}
        </>
      )}

      {view === "stock" && canStock && <StockProducts openInventory={() => go("Inventory")} />}

      {view === "analytics" && (canRevenue || canAnalytics) && (
        <>
          {canRevenue && (
            <>
              <div className={css.two}>
                <TopStatesCard onViewMap={showMap} />
                {canStock && <ProductPerformance />}
              </div>
              <div ref={mapRef} className={css.mapAnchor}>
                <OpsMapCard />
              </div>
              <section className="erp-stack-tight">
                <ZoneLabel>{L("This month", "Bulan ini")}</ZoneLabel>
                <RevenueAndHoursCard user={user} go={go} lang={lang} />
              </section>
            </>
          )}
          {canAnalytics && <TikTokAnalyticsCard />}
        </>
      )}

      {view === "sync" && (
        <>
          <section className={card} aria-label={L("Sync with TikTok", "Segerak dengan TikTok")}>
            <div className={css.cardHead}>
              <div>
                <PanelTitle icon="refresh">{L("Sync with TikTok", "Segerak dengan TikTok")}</PanelTitle>
                <p className={`erp-meta ${conn.tone === "ok" ? "" : css.warnText}`}>{tt.statusLoaded ? conn.text : "…"}</p>
              </div>
              {tt.canSync && (
                <button type="button" className={btnSmPrimary} disabled={tt.busy} aria-busy={tt.busy} onClick={() => void tt.sync()}>
                  <AppIcon name="refresh" />{tt.busy ? L("Syncing…", "Menyegerak…") : L("Sync now", "Segerak sekarang")}
                </button>
              )}
            </div>
            <dl className={css.syncFacts}>
              <div><dt>{L("Last sync from this screen", "Segerak terakhir dari skrin ini")}</dt><dd>{tt.result ? timeMYT(tt.result.at) + " MYT" : <span className={css.quiet}>{L("Not run from here yet - Sync also runs by itself every 30 minutes.", "Belum dijalankan dari sini - Segerak juga berjalan sendiri setiap 30 minit.")}</span>}</dd></div>
              {tt.result?.ok && <>
                <div><dt>{L("Imported (new)", "Diimport (baharu)")}</dt><dd className="erp-num">{tt.result.imported}</dd></div>
                <div><dt>{L("Already synced", "Sudah disegerak")}</dt><dd className="erp-num">{tt.result.skipped}</dd></div>
                {tt.result.retried > 0 && <div><dt>{L("Stock caught up", "Stok dikemas kini")}</dt><dd className="erp-num">{tt.result.retried}</dd></div>}
                {tt.result.fromTiktok != null && <div><dt>{L("Orders TikTok sent (30 days)", "Pesanan dihantar TikTok (30 hari)")}</dt><dd className="erp-num">{tt.result.fromTiktok}</dd></div>}
              </>}
              <div><dt>{L("Live updates refused (7 days)", "Kemas kini langsung ditolak (7 hari)")}</dt><dd className="erp-num">{tt.status?.failed_events_7d ?? "—"}</dd></div>
              <div><dt>{L("Waiting for stock (no movement)", "Menunggu stok (tiada pergerakan)")}</dt><dd className="erp-num">{oc ? oc.no_stock ?? 0 : "…"}</dd></div>
            </dl>
            {tt.result && !tt.result.ok && <p className="erp-note erp-note-warning" role="alert">{tt.result.message}</p>}
            {tt.result?.ok && tt.result.problems.length > 0 && (
              <div className={css.problems}>
                <p className={css.problemsTitle}>{L("Needs attention from this sync", "Perlu perhatian daripada segerak ini")}</p>
                <ul>{tt.result.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            <p className={css.explain}>{L("Imported means a new order this sync added. Already synced means the portal had it - from a live update or an earlier sync - and it is never added twice. A refused live update is one that failed TikTok's security check; it changes nothing, and Sync still brings the order in.",
              "Diimport bermaksud pesanan baharu yang ditambah oleh segerak ini. Sudah disegerak bermaksud portal sudah memilikinya - dari kemas kini langsung atau segerak terdahulu - dan ia tidak pernah ditambah dua kali. Kemas kini langsung yang ditolak ialah yang gagal semakan keselamatan TikTok; ia tidak mengubah apa-apa, dan Segerak masih membawa pesanan masuk.")}</p>
          </section>
          <ConnectionStatusCard technical={tt.technical} />
          <TikTokOrders mode="full" stock="none" pills={false} reloadKey={reloadKey}
            title={L("Orders that moved no stock", "Pesanan yang tidak menggerakkan stok")} />
        </>
      )}
    </TabPage>
  );
}
