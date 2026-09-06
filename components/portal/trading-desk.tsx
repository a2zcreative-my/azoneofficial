"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { ActiveStokisSummary, DashSummary, HourBucket, InTodaySummary, LowStockSummary, OutstandingDocsSummary, PendingClaimsSummary, PendingLeaveSummary, REVENUE_ROLES, RevLineLite, RevenueData, autoTargetCents } from "@/components/portal/dashboard";
import { AttendanceDonutCard, MonthlyBarsCard, TodayAssignmentsCard } from "@/components/portal/dashboard-cards";
import { LiveScheduleCard, OtApprovalsCard } from "@/components/portal/live-cards";
import { DAY_NAMES, L, User } from "@/components/portal/page-shared";
import { ClientsCard, PnlCard } from "@/components/portal/sales";
import { SalesByHourCard } from "@/components/portal/sales-by-hour-card";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelCard, SkelStat, SkelText, StaleHint } from "@/components/ui/skeleton";
import { MiniBar, StatCard } from "@/components/ui/stat-card";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmy, fmtRM, ym } from "@/lib/format";
import { Lang, t as tr } from "@/lib/i18n";
import { TabName } from "@/lib/portal-tabs";
import { btnSmPrimary, card } from "@/lib/ui-styles";
import { ReactNode, useCallback, useEffect, useState } from "react";

export function TradingDesk({
  user,
  go,
  lang = "en",
}: {
  user: User;
  go?: (t: TabName) => void;
  lang?: Lang;
}) {
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const [rev, setRev] = useState<RevenueData | null>(null);
  const [sum, setSum] = useState<DashSummary | null>(null);
  const [mkLines, setMkLines] = useState<RevLineLite[] | null>(null);
  const [hours, setHours] = useState<HourBucket[] | null>(null);
  const canRevenue = REVENUE_ROLES.includes(user.role);
  const canStatus = [
    "super_admin",
    "admin",
    "ceo",
    "coo",
    "cco",
    "hr_admin",
  ].includes(user.role);
  // v1.6.1 (CEO): the monthly KPI target is set right here on the dashboard,
  // and only these three roles may change it.
  const canEditKpi = ["super_admin", "ceo", "coo"].includes(user.role);
  const [editingKpi, setEditingKpi] = useState(false);
  const [kpiDraft, setKpiDraft] = useState("");
  const { show: showKpiToast, node: kpiToastNode } = useSaveToast();
  /* v1.25.0 — remembered-first (CEO chose "instant everywhere, mark money"):
     the ticker paints its last known figures the moment the tab opens and
     shows an "updating…" dot until the fresh numbers land, so nobody reads a
     stale amount as final. Cache is per-account and expires after 24h. */
  const revCache = useCachedApi<RevenueData>(
    canRevenue ? "/staff/revenue" : null,
    canRevenue
  );
  const sumCache = useCachedApi<DashSummary>("/staff/dashboard/summary");
  const moneyStale = revCache.stale || sumCache.stale;
  useEffect(() => {
    if (revCache.data) setRev(revCache.data);
  }, [revCache.data]);
  useEffect(() => {
    if (sumCache.data) setSum(sumCache.data);
  }, [sumCache.data]);
  const loadRev = revCache.refresh;
  useEffect(() => {
    if (canRevenue) {
      void api<{ lines: RevLineLite[] }>(`/staff/revenue/lines`).then((r) => {
        if (r.ok && r.data) setMkLines(r.data.lines);
      });
      void api<{ buckets: HourBucket[] }>(`/staff/sales/by-hour`).then((r) => {
        if (r.ok && r.data) setHours(r.data.buckets);
      });
    }
  }, [canRevenue]);

  const saveKpi = async () => {
    const v = Number(kpiDraft);
    if (!rev) return;
    if (!v || v <= 0) {
      showKpiToast(
        L("No change", "Tiada perubahan"),
        L("Enter a target amount first", "Masukkan amaun sasaran dahulu"),
        "notice"
      );
      return;
    }
    const res = await api(`/staff/revenue/target`, {
      method: "POST",
      body: JSON.stringify({
        month: rev.month,
        target_cents: Math.round(v * 100),
      }),
    });
    if (res.ok) {
      showKpiToast(
        L("Saved", "Disimpan"),
        L(
          `Monthly KPI target — ${fmtRM(Math.round(v * 100))}`,
          `Sasaran KPI bulanan — ${fmtRM(Math.round(v * 100))}`
        )
      );
      setEditingKpi(false);
      loadRev();
    }
  };

  /* ---- shared derived figures ---- */
  const monthTotal = rev
    ? rev.tiktok.this_cents +
      rev.invoiced.this_cents +
      (rev.other?.this_cents ?? 0) +
      (rev.manual?.this_cents ?? 0)
    : 0;
  const lastTotal = rev
    ? rev.tiktok.last_cents +
      rev.invoiced.last_cents +
      (rev.other?.last_cents ?? 0) +
      (rev.manual?.last_cents ?? 0)
    : 0;
  // Manual target (set on the Ecommerce tab) wins; otherwise auto from history.
  const autoT = autoTargetCents(lastTotal);
  const target = rev?.target_cents || autoT;
  const targetIsAuto = !rev?.target_cents && !!autoT;
  const nowM = new Date(Date.now() + 8 * 3600 * 1000);
  const daysInMonth = new Date(
    Date.UTC(nowM.getUTCFullYear(), nowM.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const dayOfMonth = nowM.getUTCDate();
  const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const pct = target ? Math.round((monthTotal / target) * 100) : null;
  const onPace = pct !== null && pct >= expectedPct;

  /* ---- ticker cards ---- */
  const ticker: ReactNode[] = [];
  if (canRevenue && rev?.today) {
    const t = rev.today;
    const todayTotal =
      t.tiktok_cents +
      t.invoiced_cents +
      (t.other_cents ?? 0) +
      (t.manual_cents ?? 0);
    const y = rev.yesterday?.total_cents ?? 0;
    const up = todayTotal >= y;
    ticker.push(
      <div key="today" className="bg-brand rounded-xl p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">
          🔥 {tr("Today's sales · LIVE", lang)}
        </p>
        <p className="mt-1 text-2xl leading-tight font-bold tabular-nums">
          {fmtRM(todayTotal)}
        </p>
        {(todayTotal > 0 || y > 0) && (
          <p
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${up ? "bg-bull/25 text-green-200" : "bg-bear/25 text-red-200"}`}
          >
            {up ? "▲" : "▼"} {fmtRM(Math.abs(todayTotal - y))}{" "}
            {tr("vs yesterday", lang)}
          </p>
        )}
        <p className="mt-1 text-xs text-white/80">
          {lang === "ms"
            ? `${t.tiktok_orders} ${tr("TikTok orders", lang)}`
            : `${t.tiktok_orders} TikTok order${t.tiktok_orders === 1 ? "" : "s"}`}
          {t.invoiced_cents > 0
            ? ` · ${lang === "ms" ? "invois" : "invoiced"} ${fmtRM(t.invoiced_cents)}`
            : ""}
        </p>
      </div>
    );
  }
  if (canRevenue && rev) {
    ticker.push(
      <StatCard
        key="month"
        label={`${tr("Revenue", lang)} — ${ym(rev.month)}`}
        value={fmtRM(monthTotal)}
        bar={
          target
            ? {
                pct: (monthTotal / target) * 100,
                label: `${Math.round((monthTotal / target) * 100)}% ${lang === "ms" ? "daripada" : "of"} ${fmtRM(target)} ${tr(targetIsAuto ? "auto-target" : "target", lang)}`,
                tone: monthTotal >= target ? "green" : "gold",
              }
            : undefined
        }
        sub={
          target
            ? undefined
            : lang === "ms"
              ? "bulan pertama data — sasaran auto bermula bulan depan"
              : "first month of data — the auto-target starts next month"
        }
      />
    );
    if (rev.overall && rev.overall.total_cents > 0) {
      const ov = rev.overall;
      const best = ov.best;
      const thisMonthCents =
        ov.months.find((m) => m.month === rev.month)?.cents ?? 0;
      ticker.push(
        <StatCard
          key="overall"
          label={`📈 ${tr("All-time — every channel", lang)}`}
          value={fmtRM(ov.total_cents)}
          bar={
            best && best.cents > 0
              ? {
                  pct: (thisMonthCents / best.cents) * 100,
                  label:
                    best.month === rev.month
                      ? tr("this month is your best yet 🏆", lang)
                      : `${tr("vs best month", lang)} (${ym(best.month)} · ${fmtRM(best.cents)})`,
                  tone: thisMonthCents >= best.cents ? "green" : "navy",
                }
              : undefined
          }
          sub={
            lang === "ms"
              ? `${ov.months.length} ${tr("months of business", lang)}`
              : `${ov.months.length} month${ov.months.length === 1 ? "" : "s"} of business`
          }
        />
      );
    }
  }
  // v1.6.1 (CEO): "Needs attention" sits in the top ticker row, right beside
  // the All-time card (position 4), instead of a separate strip at the bottom.
  if (canStatus && sum) {
    const rows: [string, number | null, TabName][] = [
      ["Leave pending", sum.pending_leave, "HR"],
      ["Claims pending", sum.pending_claims, "Claims"],
      ["OT pending", sum.pending_ot, "Attendance"],
      ["Low stock", sum.low_stock, "Inventory"],
      ["Quotations open", sum.open_quotations, "Sales"],
    ];
    const shown = rows.filter(([, v]) => v !== null && v > 0);
    ticker.push(
      <div
        key="attention"
        className="border-border bg-card border-t-brand rounded-xl border border-t-2 p-4 shadow-sm"
      >
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {tr("Needs attention", lang)}
        </p>
        {shown.length === 0 ? (
          <p className="mt-2 text-sm">
            ✅ {tr("Nothing waiting on you", lang)}
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {/* v1.23.2: translate ONLY the display — setDetailModal keeps
                  the EN key, which the modal switch below compares against. */}
            {shown.map(([label, v, _tabName]) => (
              <button
                type="button"
                key={label}
                onClick={() => setDetailModal(label)}
                className="hover:text-primary flex w-full items-baseline justify-between text-sm hover:underline"
              >
                <span>{tr(label, lang)}</span>
                <span className="font-bold tabular-nums">{v}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  // Unpaid invoices card comes last (only when there are any) so it never
  // pushes "Needs attention" out of the top row.
  if (canRevenue && rev?.outstanding && rev.outstanding.docs > 0) {
    ticker.push(
      <StatCard
        key="out"
        accent="red"
        label={L("Unpaid invoices", "Invois belum dibayar")}
        value={fmtRM(rev.outstanding.cents)}
        sub={L(
          `${rev.outstanding.docs} invoice${rev.outstanding.docs === 1 ? "" : "s"} awaiting payment — collect first`,
          `${rev.outstanding.docs} invois menunggu bayaran — kutip dahulu`
        )}
      />
    );
  }

  /* ---- market targets: product vs service ---- */
  const thisM = rev?.month ?? "";
  const lastM = rev?.last_month ?? "";
  const markets = (mkLines ?? [])
    .map((l) => {
      const now = l.months.find((m) => m.month === thisM)?.cents ?? 0;
      const last = l.months.find((m) => m.month === lastM)?.cents ?? 0;
      const t = autoTargetCents(last);
      return {
        key: l.key,
        label: l.label.split(" (")[0] ?? l.key,
        now,
        last,
        target: t,
      };
    })
    .filter((m) => m.now > 0 || m.last > 0);

  /* ---- motivation ---- */
  let motivation: { emoji: string; text: string; cls: string } | null = null;
  if (canRevenue && rev && target && pct !== null) {
    const daysLeft = Math.max(1, daysInMonth - dayOfMonth);
    const needPerDay = Math.max(0, target - monthTotal) / daysLeft;
    if (pct >= 100) {
      motivation = {
        emoji: "🏆",
        text: L(
          `TARGET SMASHED — ${fmtRM(monthTotal)} against ${fmtRM(target)}. Every ringgit from here is a new record. Set the bar higher!`,
          `SASARAN DIPECAHKAN — ${fmtRM(monthTotal)} berbanding ${fmtRM(target)}. Setiap ringgit dari sini adalah rekod baharu. Naikkan lagi sasaran!`
        ),
        cls: "bg-success-soft text-success",
      };
    } else if (onPace) {
      motivation = {
        emoji: "✅",
        text: L(
          `On pace — day ${dayOfMonth}/${daysInMonth} expects ~${expectedPct}%, you're at ${pct}%. Hold this rhythm and the month is yours.`,
          `Ikut rentak — hari ${dayOfMonth}/${daysInMonth} menjangka ~${expectedPct}%, anda di ${pct}%. Kekalkan rentak ini dan bulan ini milik anda.`
        ),
        cls: "bg-success-soft text-success",
      };
    } else if (expectedPct - pct <= 15) {
      motivation = {
        emoji: "⚡",
        text: L(
          `Push time — ${pct}% done, pace says ${expectedPct}%. ${fmtRM(Math.round(needPerDay))} a day for the next ${daysLeft} day${daysLeft === 1 ? "" : "s"} closes the gap. One good LIVE changes this.`,
          `Masa untuk berusaha — ${pct}% dicapai, rentak sepatutnya ${expectedPct}%. ${fmtRM(Math.round(needPerDay))} sehari untuk ${daysLeft} hari seterusnya menutup jurang. Satu LIVE yang baik boleh mengubahnya.`
        ),
        cls: "bg-warning-soft text-warning",
      };
    } else {
      motivation = {
        emoji: "🚀",
        text: L(
          `Comeback mode — ${fmtRM(Math.max(0, target - monthTotal))} to go. Break it down: that's ${fmtRM(Math.round(needPerDay))} a day. Book the lives, chase the quotes, move the stock.`,
          `Mod bangkit semula — ${fmtRM(Math.max(0, target - monthTotal))} lagi. Pecahkan: itu ${fmtRM(Math.round(needPerDay))} sehari. Jadualkan LIVE, kejar sebut harga, gerakkan stok.`
        ),
        cls: "bg-danger-soft text-danger",
      };
    }
  }

  /* ---- data-driven boost suggestions ---- */
  const tips: string[] = [];
  if (canRevenue && rev) {
    const peak = (hours ?? []).reduce<HourBucket | null>(
      (a, b) => (b.cents > (a?.cents ?? 0) ? b : a),
      null
    );
    if (peak && peak.cents > 0) {
      tips.push(
        L(
          `Schedule the next LIVE at ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00 — your best-selling hour this week (${fmtRM(peak.cents)} across ${peak.orders} orders).`,
          `Jadualkan LIVE seterusnya pada ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00 — jam jualan terbaik anda minggu ini (${fmtRM(peak.cents)} daripada ${peak.orders} pesanan).`
        )
      );
    }
    if (rev.outstanding && rev.outstanding.docs > 0) {
      tips.push(
        L(
          `Chase the ${rev.outstanding.docs} unpaid invoice${rev.outstanding.docs === 1 ? "" : "s"} (${fmtRM(rev.outstanding.cents)}) — it's revenue you already earned.`,
          `Kejar ${rev.outstanding.docs} invois belum dibayar (${fmtRM(rev.outstanding.cents)}) — itu hasil yang anda sudah peroleh.`
        )
      );
    }
    if ((sum?.open_quotations ?? 0) > 0) {
      tips.push(
        L(
          `${sum!.open_quotations} quotation${sum!.open_quotations === 1 ? "" : "s"} still open — a follow-up call today converts faster than a new lead.`,
          `${sum!.open_quotations} sebut harga masih terbuka — panggilan susulan hari ini lebih cepat bertukar jualan daripada prospek baharu.`
        )
      );
    }
    if ((sum?.low_stock ?? 0) > 0) {
      tips.push(
        L(
          `${sum!.low_stock} item${sum!.low_stock === 1 ? "" : "s"} low on stock — restock before the next live so a bestseller never sells out mid-stream.`,
          `${sum!.low_stock} barang stok rendah — tambah stok sebelum LIVE seterusnya supaya barang laris tidak habis di tengah siaran.`
        )
      );
    }
    const weakest = markets
      .filter((m) => m.target && m.now < m.target)
      .sort((a, b) => a.now / a.target! - b.now / b.target!)[0];
    if (weakest?.target) {
      tips.push(
        L(
          `${weakest.label} is at ${Math.round((weakest.now / weakest.target) * 100)}% of its market target — ${fmtRM(weakest.target - weakest.now)} more takes it home.`,
          `${weakest.label} berada pada ${Math.round((weakest.now / weakest.target) * 100)}% daripada sasaran pasarannya — ${fmtRM(weakest.target - weakest.now)} lagi untuk mencapainya.`
        )
      );
    }
  }

  /* v1.77.0 — skeleton until the first fetch lands. While the revenue and
     summary requests are still in flight, the ticker holds stat-shaped
     placeholders in the same slots (today · month · all-time · attention)
     so the row does not jump when the figures arrive. */
  const revLoading = canRevenue && rev === null;
  const sumLoading = canStatus && sum === null;
  if (revLoading) {
    ticker.push(
      <SkelStat key="skel-today" />,
      <SkelStat key="skel-month" />,
      <SkelStat key="skel-overall" />
    );
  }
  if (sumLoading) ticker.push(<SkelStat key="skel-attention" />);

  if (ticker.length === 0 && !canStatus) return null;

  // v1.8.0: peak selling hour (reference "Peak activity time") from the
  // by-hour data this component already loads.
  const peakBucket = (hours ?? []).reduce<HourBucket | null>(
    (a, b) => (b.cents > (a?.cents ?? 0) ? b : a),
    null
  );
  const nowMY = new Date(Date.now() + 8 * 3600 * 1000);
  const WEEKDAYS = DAY_NAMES[lang];
  return (
    <div className="space-y-3 md:space-y-4">
      {kpiToastNode}
      {/* v1.8.0 put a greeting here ("Hello, Sarah!"); v1.116.0 removed it -
          the header already greets, and the Dashboard now reads in zones.
          This is the THE COMPANY zone's caption, kept inside the desk so it
          disappears with it for roles that do not see the desk. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-muted-foreground px-1 text-[10px] font-semibold tracking-widest uppercase">
          {L("The company", "Syarikat")}
        </p>
        <p className="text-muted-foreground flex items-center gap-2 text-xs md:text-sm">
          {/* v1.25.0: sits directly above the money ticker, so "updating…"
              clearly belongs to the figures underneath it. */}
          <StaleHint show={moneyStale} />
          {WEEKDAYS[nowMY.getUTCDay()]}, {dmy(nowMY.toISOString().slice(0, 10))}
        </p>
      </div>
      {/* Zone 1 — the ticker (Today · Revenue · All-time · Needs attention) */}
      {ticker.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{ticker}</div>
      )}

      {/* v1.77.0 — skeleton until the first fetch lands (pulse strip, six tiles). */}
      {sumLoading && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="border-border bg-card flex flex-col items-center justify-center rounded-lg border p-2.5"
            >
              <Skel className="h-5 w-10" />
              <Skel className="mt-1.5 h-2 w-14" />
            </div>
          ))}
        </div>
      )}
      {/* v1.7.0 company pulse — one compact strip of live counters. */}
      {canStatus &&
        sum &&
        (() => {
          const cashIn = sum.cash_in_cents ?? 0;
          const cashOut = sum.cash_out_cents ?? 0;
          const net = cashIn - cashOut;
          /* label = the EN modal-routing key (NEVER translated); show = display only. */
          const tiles: {
            label: string;
            show?: string;
            value: ReactNode;
            tone?: string;
            tab?: TabName;
          }[] = [
            {
              label: "Clients",
              show: L("Clients", "Pelanggan"),
              value: sum.clients ?? 0,
              tab: "Sales",
            },
            {
              label: "Active stokis",
              show: L("Active stokis", "Stokis aktif"),
              value: sum.active_stokis ?? 0,
              tab: "Stokis",
            },
            {
              label: "Lives today",
              show: L("Lives today", "LIVE hari ini"),
              value: sum.lives_today ?? 0,
              tab: "Attendance",
            },
            {
              label: "In today",
              show: L("In today", "Hadir hari ini"),
              value: sum.attendance_today ?? 0,
              tab: "Attendance",
            },
            {
              label: "Unpaid inv.",
              show: L("Unpaid inv.", "Inv. belum bayar"),
              value: sum.outstanding_invoices ?? 0,
              tab: "Sales",
            },
            {
              label: "Cash flow (mo)",
              show: L("Cash flow (mo)", "Aliran tunai (bln)"),
              value: (
                <span className={net >= 0 ? "text-bull" : "text-bear"}>
                  {net >= 0 ? "" : "−"}
                  {fmtRM(Math.abs(net))}
                </span>
              ),
              tab: "Finance",
            },
            // v1.8.0 (reference "Peak activity time"): the week's best-selling hour
            ...(peakBucket && peakBucket.cents > 0
              ? [
                  {
                    label: "Peak hour (wk)",
                    show: L("Peak hour (wk)", "Jam puncak (mgu)"),
                    value: (
                      <span className="whitespace-nowrap">
                        {String(peakBucket.hour).padStart(2, "0")}–
                        {String((peakBucket.hour + 1) % 24).padStart(2, "0")}
                      </span>
                    ),
                    tab: "Ecommerce" as TabName,
                  },
                ]
              : []),
          ];
          return (
            <div
              className={`grid grid-cols-3 gap-2 ${tiles.length > 6 ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-6"}`}
            >
              {tiles.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setDetailModal(t.label)}
                  className="border-border bg-card hover:border-primary flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-colors"
                >
                  <p className="text-lg leading-tight font-bold tabular-nums">
                    {t.value}
                  </p>
                  <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {t.show ?? t.label}
                  </p>
                </button>
              ))}
            </div>
          );
        })()}

      {/* v1.77.0 — skeleton until the first fetch lands (sales floor card). */}
      {revLoading && <SkelCard lines={4} />}

      {/* Zone 2+3 — KPI + markets, one desk card */}
      {canRevenue && rev && (target || markets.length > 0 || canEditKpi) && (
        <div className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              📊 {L("Sales floor", "Lantai jualan")} — {ym(rev.month)}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {L("day", "hari")} {dayOfMonth}/{daysInMonth} ·{" "}
              {L("pace", "rentak")} {expectedPct}%
            </p>
          </div>

          {/* v1.6.1: set/edit the monthly KPI target right here (CEO/COO/super). */}
          {editingKpi ? (
            <div className="border-border mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">
                {L("Target for", "Sasaran untuk")} {ym(rev.month)}:
              </span>
              <span className="flex items-center gap-1 text-sm">
                RM
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  autoFocus
                  className="border-input bg-background h-9 w-36 rounded-lg border px-2 text-sm"
                  placeholder={L("e.g. 35000", "cth. 35000")}
                  value={kpiDraft}
                  onChange={(e) => setKpiDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveKpi();
                    if (e.key === "Escape") setEditingKpi(false);
                  }}
                />
              </span>
              <button
                type="button"
                className={btnSmPrimary}
                onClick={() => void saveKpi()}
              >
                {L("Save target", "Simpan sasaran")}
              </button>
              <button
                type="button"
                className="text-muted-foreground text-xs underline"
                onClick={() => setEditingKpi(false)}
              >
                {L("Cancel", "Batal")}
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold tracking-wide uppercase">
                  🎯 {L("KPI — month target", "KPI — sasaran bulan")}{" "}
                  {target
                    ? targetIsAuto
                      ? L("(auto: last month +10%)", "(auto: bulan lepas +10%)")
                      : ""
                    : ""}
                </span>
                <span className="flex items-baseline gap-2">
                  {target ? (
                    <span className="font-bold tabular-nums">
                      {fmtRM(monthTotal)} / {fmtRM(target)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {L("no target set", "tiada sasaran ditetapkan")}
                    </span>
                  )}
                  {canEditKpi && (
                    <button
                      type="button"
                      className="text-gold-deep text-xs font-medium underline"
                      onClick={() => {
                        setKpiDraft(
                          rev.target_cents
                            ? (rev.target_cents / 100).toString()
                            : target
                              ? (target / 100).toString()
                              : ""
                        );
                        setEditingKpi(true);
                      }}
                    >
                      {rev.target_cents
                        ? L("Edit target", "Sunting sasaran")
                        : L("Set target", "Tetapkan sasaran")}
                    </button>
                  )}
                </span>
              </div>
              {target && pct !== null && (
                <div className="bg-secondary relative mt-1.5 h-5 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-bull" : pct >= 70 ? "bg-gold-solid" : pct >= 40 ? "bg-warning" : "bg-bear"}`}
                    style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }}
                  />
                  {/* pace marker: where the month says you SHOULD be */}
                  <div
                    className="bg-foreground/60 absolute inset-y-0 w-0.5"
                    style={{ left: `${Math.min(99, expectedPct)}%` }}
                    title={L(
                      `pace: ${expectedPct}%`,
                      `rentak: ${expectedPct}%`
                    )}
                  />
                  <span
                    className={`absolute inset-0 flex items-center text-[11px] font-bold ${pct >= 12 ? "justify-start pl-2 text-white" : "text-foreground justify-start"}`}
                    style={
                      pct < 12
                        ? { paddingLeft: `calc(${Math.max(pct, 1)}% + 6px)` }
                        : undefined
                    }
                  >
                    {pct}%
                  </span>
                </div>
              )}
              {!target && canEditKpi && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {L(
                    "Set this month's KPI target to turn on the progress bar and the pace tracker.",
                    "Tetapkan sasaran KPI bulan ini untuk menghidupkan bar kemajuan dan penjejak rentak."
                  )}
                </p>
              )}
            </div>
          )}
          {motivation && (
            <p
              className={`mt-2.5 rounded-lg px-3 py-2 text-xs font-medium ${motivation.cls}`}
            >
              {motivation.emoji} {motivation.text}
            </p>
          )}
          {markets.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                {L(
                  "Market targets — product · service",
                  "Sasaran pasaran — produk · perkhidmatan"
                )}
              </p>
              <div className="mt-1.5 space-y-2">
                {markets.map((m) => {
                  const mPct = m.target
                    ? Math.round((m.now / m.target) * 100)
                    : null;
                  return (
                    <div
                      key={m.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="w-24 shrink-0 capitalize md:w-32">
                        {m.label}
                      </span>
                      <div className="flex-1">
                        <MiniBar
                          pct={
                            m.target
                              ? (m.now / m.target) * 100
                              : m.now > 0
                                ? 100
                                : 0
                          }
                          tone={
                            mPct !== null && mPct >= 100
                              ? "green"
                              : m.key === "service"
                                ? "gold"
                                : "navy"
                          }
                        />
                      </div>
                      <span className="shrink-0 text-right text-xs tabular-nums md:text-sm">
                        <span className="font-semibold">{fmtRM(m.now)}</span>
                        {m.target && (
                          <span className="text-muted-foreground">
                            {" "}
                            / {fmtRM(m.target)} ({mPct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {L(
                  "Each line's target = its own last month + 10% (auto). Momentum, per business.",
                  "Sasaran setiap bidang = bulan lepasnya sendiri + 10% (auto). Momentum, mengikut perniagaan."
                )}
              </p>
            </div>
          )}
          {tips.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                💡 {L("Boost the number", "Tingkatkan angka")}
              </p>
              <ul className="mt-1.5 space-y-1">
                {tips.slice(0, 4).map((t) => (
                  <li key={t} className="flex gap-2 text-xs">
                    <span aria-hidden className="text-gold-deep">
                      ▸
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* v1.8.0 — reference-design cards: attendance donut · today's
          assignments · month-by-month bars. */}
      {canStatus && (
        /* v1.23.3: [&>*]:min-w-0 — grid tracks are minmax(auto,1fr); one
           wide child (the assignments table was 386px min) stretches the
           track past the phone and pans the WHOLE page. Never again. */
        <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {sum && (
            <AttendanceDonutCard
              onTime={sum.attendance_on_time ?? 0}
              late={sum.attendance_late ?? 0}
              staffTotal={sum.staff_total ?? 0}
              onOpen={() => setDetailModal("In today")}
            />
          )}
          <TodayAssignmentsCard
            onOpenRoster={go ? () => go("Attendance") : undefined}
            canManage={[
              "ceo",
              "coo",
              "cco",
              "hr_admin",
              "super_admin",
              "admin",
            ].includes(user.role)}
          />
          {canRevenue && rev?.overall && rev.overall.months.length > 1 && (
            <MonthlyBarsCard months={rev.overall.months} />
          )}
        </div>
      )}

      {detailModal && (
        <div
          className="animate-in fade-in fixed inset-0 z-[100] flex flex-col items-center justify-end overflow-hidden bg-black/60 backdrop-blur-sm transition-all sm:justify-center sm:p-6"
          onClick={() => setDetailModal(null)}
        >
          <div
            className="bg-background animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:zoom-in-95 relative flex max-h-[90vh] w-full flex-col rounded-t-2xl shadow-2xl sm:max-w-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-muted/20 flex shrink-0 items-center justify-between rounded-t-2xl border-b px-4 py-3 sm:rounded-t-2xl sm:px-5 sm:py-4">
              <h2 className="text-lg font-bold">
                {L(
                  detailModal,
                  (
                    {
                      Clients: "Pelanggan",
                      "Active stokis": "Stokis aktif",
                      "Lives today": "LIVE hari ini",
                      "In today": "Hadir hari ini",
                      "Unpaid inv.": "Inv. belum bayar",
                      "Cash flow (mo)": "Aliran tunai (bln)",
                      "Peak hour (wk)": "Jam puncak (mgu)",
                      "Leave pending": "Cuti menunggu",
                      "Claims pending": "Tuntutan menunggu",
                      "OT pending": "OT menunggu",
                      "Low stock": "Stok rendah",
                      "Quotations open": "Sebut harga terbuka",
                    } as Record<string, string>
                  )[detailModal] ?? detailModal
                )}
              </h2>
              <button
                type="button"
                className="bg-secondary hover:bg-muted rounded-full p-2"
                onClick={() => setDetailModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="relative w-full overflow-y-auto">
              {detailModal === "Clients" && <ClientsCard inModal />}
              {detailModal === "Active stokis" && <ActiveStokisSummary />}
              {detailModal === "Lives today" && (
                <LiveScheduleCard user={user} inModal />
              )}
              {detailModal === "In today" && <InTodaySummary />}
              {detailModal === "Unpaid inv." && (
                <OutstandingDocsSummary kind="INV" />
              )}
              {detailModal === "Cash flow (mo)" && <PnlCard inModal />}
              {detailModal === "Peak hour (wk)" && <SalesByHourCard />}

              {detailModal === "Leave pending" && <PendingLeaveSummary />}
              {detailModal === "Claims pending" && <PendingClaimsSummary />}
              {detailModal === "OT pending" && <OtApprovalsCard inModal />}
              {detailModal === "Low stock" && <LowStockSummary />}
              {detailModal === "Quotations open" && (
                <OutstandingDocsSummary kind="QT" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SalesRevenueCard() {
  const [rev, setRev] = useState<RevenueData | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  const loadRev = useCallback(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => {
      if (r.ok && r.data) setRev(r.data);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    loadRev();
  }, [loadRev]);
  if (!rev) {
    if (!loaded)
      return (
        <div className={card} aria-hidden>
          <Skel className="h-4 w-48" />
          <SkelText lines={2} className="mt-2" />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="border-border rounded-lg border p-3">
                <Skel className="h-2.5 w-20" />
                <Skel className="mt-2 h-6 w-28" />
                <Skel className="mt-2 h-2.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      );
    return null; // the request failed — there is no month to draw (unchanged)
  }
  const rm = fmtRM; // v1.4.272: the global — a money figure must never render two ways
  // v1.4.169 (CEO: "everything count correctly and accurately"): total sales
  // = TikTok + paid invoices + non-TikTok shipments + manual sales. The KPI
  // progress below uses this same total, so the target tracks EVERY channel.
  const total =
    rev.tiktok.this_cents +
    rev.invoiced.this_cents +
    (rev.other?.this_cents ?? 0) +
    (rev.manual?.this_cents ?? 0);
  const lastTotal =
    rev.tiktok.last_cents +
    rev.invoiced.last_cents +
    (rev.other?.last_cents ?? 0) +
    (rev.manual?.last_cents ?? 0);
  const delta =
    lastTotal > 0 ? Math.round(((total - lastTotal) / lastTotal) * 100) : null;
  const box = (label: string, value: string, sub: string) => (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>
    </div>
  );
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        {L("Sales revenue", "Hasil jualan")} — {rev.month}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "TikTok figures from synced order amounts (returned orders excluded). Invoiced figures count PAYMENTS RECEIVED (paid invoices, in the month the payment landed) — comparable with Expenses. The Total also counts non-TikTok shipments (order amount on the postage form) and manual sales (an Out − with a sold price) — every channel, one number.",
          "Angka TikTok daripada amaun pesanan yang disegerakkan (pesanan dipulangkan dikecualikan). Angka invois mengira BAYARAN DITERIMA (invois dibayar, dalam bulan bayaran diterima) — setanding dengan Perbelanjaan. Jumlah turut mengira penghantaran bukan TikTok (amaun pesanan pada borang pos) dan jualan manual (Out − dengan harga jualan) — semua saluran, satu angka."
        )}
        {/* v1.6.1: the KPI target moved to the Dashboard (set by CEO/COO). */}
      </p>
      {/* v1.4.156 (CEO: "show today sales to motivate my Sales team") —
          today leads the grid with the brand-gold accent. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* v1.4.271 audit: the 🔥 Today box moved OUT of this card — the
            hero band above owns "today" now; two cards both saying today's
            number was the audit's first finding. This card is the MONTH view. */}
        {box(
          "TikTok Shop",
          rm(rev.tiktok.this_cents),
          L(
            `${rev.tiktok.this_orders} orders · last month ${rm(rev.tiktok.last_cents)}`,
            `${rev.tiktok.this_orders} pesanan · bulan lepas ${rm(rev.tiktok.last_cents)}`
          )
        )}
        {box(
          L("Invoiced (paid)", "Invois (dibayar)"),
          rm(rev.invoiced.this_cents),
          L(
            `${rev.invoiced.this_docs} paid · last month ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · outstanding ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`,
            `${rev.invoiced.this_docs} dibayar · bulan lepas ${rm(rev.invoiced.last_cents)}${rev.outstanding && rev.outstanding.docs > 0 ? ` · tertunggak ${rm(rev.outstanding.cents)} (${rev.outstanding.docs})` : ""}`
          )
        )}
        {/* v1.4.169: the other two channels, so the Total is ALL sales */}
        {box(
          L("Other shipments", "Penghantaran lain"),
          rm(rev.other?.this_cents ?? 0),
          L(
            `${rev.other?.this_orders ?? 0} non-TikTok order${(rev.other?.this_orders ?? 0) === 1 ? "" : "s"} with amount · last month ${rm(rev.other?.last_cents ?? 0)}`,
            `${rev.other?.this_orders ?? 0} pesanan bukan TikTok dengan amaun · bulan lepas ${rm(rev.other?.last_cents ?? 0)}`
          )
        )}
        {box(
          L("Manual sales", "Jualan manual"),
          rm(rev.manual?.this_cents ?? 0),
          L(
            `${rev.manual?.this_units ?? 0} unit${(rev.manual?.this_units ?? 0) === 1 ? "" : "s"} sold via Out − · last month ${rm(rev.manual?.last_cents ?? 0)}`,
            `${rev.manual?.this_units ?? 0} unit dijual melalui Out − · bulan lepas ${rm(rev.manual?.last_cents ?? 0)}`
          )
        )}
        {box(
          L("Total — all channels", "Jumlah — semua saluran"),
          rm(total),
          delta === null
            ? L(`last month ${rm(lastTotal)}`, `bulan lepas ${rm(lastTotal)}`)
            : L(
                `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`,
                `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% berbanding bulan lepas`
              )
        )}
      </div>
      {/* v1.6.1: last month's KPI result stays as context; the editable KPI
          target itself now lives on the Dashboard's Sales Floor. */}
      {rev.last_target_cents
        ? (() => {
            const lastPct = Math.round(
              (lastTotal / rev.last_target_cents!) * 100
            );
            const hit = lastPct >= 100;
            return (
              <p
                className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${hit ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
              >
                {hit ? "🏆" : "📈"} {L("Last month", "Bulan lepas")} (
                {ym(rev.last_month)}): {rm(lastTotal)} {L("of", "daripada")}{" "}
                {rm(rev.last_target_cents!)} — {lastPct}%{" "}
                {hit
                  ? L(
                      "TARGET HIT — keep the streak going!",
                      "SASARAN DICAPAI — teruskan momentum!"
                    )
                  : L(
                      "— this month is the comeback.",
                      "— bulan ini masa bangkit semula."
                    )}
              </p>
            );
          })()
        : null}
    </div>
  );
}
