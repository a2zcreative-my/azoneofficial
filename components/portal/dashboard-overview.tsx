"use client";

/**
 * v1.203.0 - THE DASHBOARD OVERVIEW (A2Z OS 2.0, the owner's reference,
 * 24-10-2026): a welcome header, five figure tiles, then three rows of three
 * cards - Recent Activities, Task Overview, Sales Performance; Live
 * Sessions, Team On Shift, Upcoming & Pending; Quick Actions, Business
 * Summary, System Status.
 *
 * A PRESENTATION LAYER AND NOTHING ELSE. Every figure is read from a request
 * a module already answers, through the same remembered views the modules
 * use, so the Dashboard and the module can never disagree:
 *   sales          /staff/revenue (the month figure the Sales floor shows:
 *                  TikTok + paid invoices + other shipments + manual sales)
 *   history        /staff/revenue overall.months (every revenue line - it
 *                  also counts stokis and ELFIA web orders, so it is
 *                  captioned, never presented as the headline)
 *   quotations,
 *   stock, people  /staff/dashboard/summary (each field only when the worker
 *                  says this person may see it)
 *   inventory      /staff/inventory
 *   tasks          /staff/tasks (?all=1 for the managing roles - the same
 *                  view the Tasks page reads), counted by lib/task-figures
 *   activities     /audit (the admin tier: CEO, admin, super admin), the
 *                  trail every module already writes; company news otherwise
 *   on shift       /staff/attendance/monitor (the managing roles)
 *   lives          /staff/live-sessions
 *   upcoming       /staff/desk (the decisions waiting on you), the task
 *                  board, /staff/events, your own pending leave
 *   system         /system/health (CEO and admin): backups, migrations,
 *                  logged errors - never an uptime figure, which the portal
 *                  does not measure
 * Nothing here writes. Every card opens the tab that owns the records, and
 * a card whose data this person may not see is not drawn.
 *
 * Not in the reference and not built: "Total Enquiries" (the Enquiries tab
 * was retired in v1.183.0 - the tile shows open quotations, the funnel the
 * Sales tab owns), "Projects & Campaigns" (no project records exist; the
 * Content tab is parked - the card shows the live sessions on the roster),
 * "Module Usage" (no usage analytics exist - a business summary instead) and
 * uptime percentages (not measured).
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { splitDesk, useDeskData } from "@/components/portal/one-desk";
import type { Announcement, LeaveReq, Task, User } from "@/components/portal/page-shared";
import { MANAGE_ROLES, annCatL, leaveTypeL, mytTodayLine } from "@/components/portal/page-shared";
import type { DashSummary, RevenueData } from "@/components/portal/dashboard";
import { useCachedApi } from "@/lib/cached-api";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang, type Lang } from "@/lib/i18n";
import { LeaveMonthCard } from "@/components/portal/leave-month-card";
import { ReportingLineCard } from "@/components/portal/reporting-line-card";
import { taskFigures } from "@/lib/task-figures";
import type { TabName } from "@/lib/portal-tabs";
import { card, chipDanger, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn } from "@/lib/ui-styles";
import ov from "./dashboard-overview.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** The month's sales exactly as the Sales floor sums them (trading-desk.tsx):
    TikTok + paid invoices + other shipments + manual sales, this month and
    last. tests/dashboard-overview.mjs holds the two sums together. */
export function revenueMonthTotals(rev: RevenueData) {
  const total = rev.tiktok.this_cents + rev.invoiced.this_cents + (rev.other?.this_cents ?? 0) + (rev.manual?.this_cents ?? 0);
  const last = rev.tiktok.last_cents + rev.invoiced.last_cents + (rev.other?.last_cents ?? 0) + (rev.manual?.last_cents ?? 0);
  const delta = last > 0 ? Math.round(((total - last) / last) * 100) : null;
  return { total, last, delta };
}

interface MonitorRow { id: number; name: string; role: string; in_at?: string | null; out_at?: string | null; last_type?: string | null; shifts?: number }
interface Session { id: number; session_date: string; start_time: string; end_time?: string | null; platform: string; host_user_id: number; host_name?: string | null; client_company?: string | null; client_name?: string | null; status: string; notes?: string | null }
interface AuditRow { id: number; action: string; entity?: string | null; entity_id?: string | null; detail?: string | null; created_at: string; user_name?: string | null }
interface CompanyEvent { id: number; title: string; category: string; event_date: string; start_time?: string | null; location?: string | null }
interface Health { errors: { id: number; created_at: string; source: string; message: string }[]; last_backup: { key: string; size: number; uploaded: string } | null; last_offsite?: string | null; migrations_pending?: string[] }
type MyShift = { known: boolean; open: boolean; since: string; out: string; hasOut: boolean };

const ADMIN_TIER = ["super_admin", "admin", "ceo"];
const REVENUE_READERS = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

/** "2026-09-18 02:00:00" (UTC, as the worker stores it) → minutes / hours / days ago */
function ago(utc: string): string {
  const t = new Date(utc.replace(" ", "T") + (utc.includes("Z") || utc.includes("+") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return L("just now", "baru sahaja");
  if (m < 60) return L(`${m} min ago`, `${m} min lalu`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`${h} h ago`, `${h} j lalu`);
  const d = Math.round(h / 24);
  return L(`${d} d ago`, `${d} h lalu`);
}
/** an ISO / UTC instant → "DD-MM-YYYY HH:MM" and its date, in Malaysia time */
const mytStamp = (instant: string) => {
  const t = new Date(instant.includes("T") ? instant : instant.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return { date: "", text: "" };
  const iso = new Date(t + 8 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), text: `${dmy(iso.slice(0, 10))} ${iso.slice(11, 16)}` };
};
/** UTC "YYYY-MM-DD HH:MM:SS" → "HH:MM" Malaysia time */
const mytHm = (utc: string) => {
  const t = new Date(utc.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(t) ? "" : new Date(t + 8 * 3600 * 1000).toISOString().slice(11, 16);
};

/* ---- the audit trail, said in words. The action names are the modules'
   own ("hotel.update", "leave.approve" ...); the verb and the noun are read
   from them, so a new action still reads sensibly without a table entry. */
const VERB: Record<string, [string, string]> = {
  create: ["added", "ditambah"], add: ["added", "ditambah"], update: ["updated", "dikemas kini"], edit: ["updated", "dikemas kini"],
  delete: ["removed", "dibuang"], remove: ["removed", "dibuang"], approve: ["approved", "diluluskan"], reject: ["rejected", "ditolak"],
  decide: ["decided", "diputuskan"], cancel: ["cancelled", "dibatalkan"], offboard: ["offboarded", "ditamatkan"], role_change: ["role changed", "peranan ditukar"],
  release: ["released", "dikeluarkan"], submit: ["submitted", "dihantar"], complete: ["completed", "diselesaikan"], stage: ["moved", "dipindah"],
  call: ["call logged", "panggilan direkodkan"], responsibilities_update: ["roles written", "peranan ditulis"], status: ["status changed", "status ditukar"],
};
const NOUN_ICON: Record<string, AppIconName> = {
  hotel: "store", asset: "package", leave: "holiday", claim: "receipt", task: "orders", staff: "person", user: "person",
  payroll: "money", invoice: "receipt", doc: "document", quotation: "document", inventory: "inventory", stock: "inventory",
  attendance: "time", ot: "time", announcement: "chat", event: "date", customer: "clients", client: "clients",
};
function auditLine(a: AuditRow): { title: string; sub: string; icon: AppIconName } {
  const [nounRaw = "", ...rest] = a.action.split(".");
  const verbKey = rest.join("_");
  const noun = nounRaw.replace(/_/g, " ");
  const verb = VERB[verbKey] ?? VERB[rest[rest.length - 1] ?? ""] ?? null;
  let what = "";
  try {
    const d = a.detail ? JSON.parse(a.detail) as Record<string, unknown> : {};
    for (const k of ["hotel_name", "name", "title", "asset_tag", "person", "staff", "doc_no", "number", "company", "employee"]) {
      if (typeof d[k] === "string" && (d[k] as string).trim()) { what = d[k] as string; break; }
    }
  } catch { /* a plain-text detail: say nothing rather than print JSON */ }
  const title = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${verb ? L(verb[0], verb[1]) : rest.join(" ").replace(/_/g, " ")}`.trim();
  return { title, sub: [what, a.user_name ? L(`by ${a.user_name}`, `oleh ${a.user_name}`) : ""].filter(Boolean).join(" · "), icon: NOUN_ICON[nounRaw] ?? "info" };
}

export function DashboardOverview({ user, go, canOpen, lang, onCreateQuotation, openAt, onOpenDay, onOpenShift, todayShift, myShift, monitor, sessions, anns, annsKnown, ownLeave }: {
  user: User;
  go: (t: TabName) => void;
  canOpen?: (t: string) => boolean;
  lang: Lang;
  onCreateQuotation?: () => void;
  openAt?: (t: TabName, view: string) => void;
  onOpenDay: () => void;
  /** v1.229.0 - where a shift shortcut goes: On Shift, which owns the punch */
  onOpenShift?: () => void;
  /** v1.229.0 - the read-only Today's Shift card (on-shift.tsx), drawn in place of My Shift */
  todayShift?: ReactNode;
  myShift: MyShift;
  /** today's monitor rows - the request the Dashboard already makes for the managing roles; null = not read */
  monitor: MonitorRow[] | null;
  /** the live sessions the Dashboard already reads */
  sessions: Session[] | null;
  anns: Announcement[];
  annsKnown: boolean;
  ownLeave: LeaveReq[];
}) {
  const can = (t: string) => (canOpen ? canOpen(t) : false);
  const manage = MANAGE_ROLES.includes(user.role);
  const adminTier = ADMIN_TIER.includes(user.role);
  const canRevenue = REVENUE_READERS.includes(user.role);
  const today = mytToday();

  /* ---- the reads: the modules' own remembered views ---- */
  const revView = useCachedApi<RevenueData>(canRevenue ? "/staff/revenue" : null, canRevenue);
  const sumView = useCachedApi<DashSummary>("/staff/dashboard/summary");
  const canInv = can("Inventory");
  const invView = useCachedApi<{ items?: { id: number; stock: number }[] }>(canInv ? "/staff/inventory" : null, canInv);
  const taskView = useCachedApi<{ tasks: Task[] }>(`/staff/tasks${manage ? "?all=1" : ""}`, true, ["tasks"]);
  const desk = useDeskData();
  const [audit, setAudit] = useState<AuditRow[] | null | "denied">(adminTier ? null : "denied");
  const [events, setEvents] = useState<CompanyEvent[] | null>(null);
  const [health, setHealth] = useState<Health | null | "denied">(adminTier ? null : "denied");
  /* the moment the card opened: a backup's age and the day's errors are read against it */
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    if (adminTier) {
      void api<{ entries?: AuditRow[] }>("/audit?limit=60").then((r) => {
        if (!live) return;
        setAudit(r.ok && r.data?.entries ? r.data.entries : "denied");
      });
      void api<Health>("/system/health").then((r) => {
        if (live) setHealth(r.ok && r.data ? r.data : "denied");
      });
    }
    void api<{ events?: CompanyEvent[] }>("/staff/events").then((r) => {
      if (live) setEvents(r.ok && r.data?.events ? r.data.events : []);
    });
    return () => { live = false; };
  }, [adminTier]);

  const rev = revView.data;
  const sales = rev ? revenueMonthTotals(rev) : null;
  const sum = sumView.data;
  const tasks = useMemo(() => taskView.data?.tasks ?? [], [taskView.data]);
  const tasksLoaded = !taskView.loading;
  const tf = taskFigures(tasks, today);
  const openOnly = tf.openTasks.length - tf.pendingCount;
  const deskItems = desk.data?.items ?? [];
  const { decide } = splitDesk(deskItems);
  const onShift = (monitor ?? []).filter((m) => m.last_type === "clock_in");
  const items = invView.data?.items ?? null;

  /* ---- B. the five tiles: the reference's five where this person may see
     them, the person's own figures where not, in a fixed order ---- */
  type Tile = { key: string; node: ReactNode };
  const tiles: Tile[] = [];
  if (canRevenue && (can("Sales") || can("Ecommerce"))) {
    tiles.push({ key: "sales", node: (
      <KpiTile icon="money" tone="green" label={L("Sales this month", "Jualan bulan ini")} busy={!rev}
        value={sales ? fmtRM(sales.total) : "—"}
        delta={sales && sales.delta !== null ? { pct: sales.delta, text: L(`${Math.abs(sales.delta)}% vs last month`, `${Math.abs(sales.delta)}% berbanding bulan lalu`) } : undefined}
        sub={sales && sales.delta === null ? L("Nothing last month to compare", "Tiada jualan bulan lalu untuk dibandingkan") : undefined}
        onClick={() => go(can("Ecommerce") ? "Ecommerce" : "Sales")} title={L("Every channel this month — open the sales figures", "Setiap saluran bulan ini — buka angka jualan")} />
    ) });
  }
  if (can("Sales") && sum && typeof sum.open_quotations === "number") {
    tiles.push({ key: "quotes", node: (
      <KpiTile icon="document" tone="purple" label={L("Open quotations", "Sebut harga terbuka")} value={sum.open_quotations}
        sub={typeof sum.outstanding_invoices === "number" ? L(`${sum.outstanding_invoices} unpaid invoice(s)`, `${sum.outstanding_invoices} invois belum dibayar`) : L("Not yet invoiced", "Belum diinvois")}
        onClick={() => go("Sales")} title={L("Quotations not yet invoiced — open Sales", "Sebut harga belum diinvois — buka Jualan")} />
    ) });
  }
  if (canInv) {
    tiles.push({ key: "stock", node: (
      <KpiTile icon="inventory" tone="blue" label={L("Inventory items", "Item inventori")} busy={items === null && invView.loading}
        value={items ? items.length : "—"}
        sub={typeof sum?.low_stock === "number" ? L(`${sum.low_stock} low stock (5 or fewer)`, `${sum.low_stock} stok rendah (5 atau kurang)`) : L("Products on the stock list", "Produk dalam senarai stok")}
        onClick={() => go("Inventory")} />
    ) });
  }
  if (manage && sum && typeof sum.staff_total === "number") {
    tiles.push({ key: "staff", node: (
      <KpiTile icon="users" tone="gold" label={L("Active staff", "Kakitangan aktif")} value={sum.staff_total}
        sub={monitor ? L(`${monitor.filter((m) => !!m.in_at).length} clocked in today`, `${monitor.filter((m) => !!m.in_at).length} daftar masuk hari ini`) : L("Working today", "Bekerja hari ini")}
        onClick={() => go(can("Staff Details") ? "Staff Details" : "Attendance")} />
    ) });
  }
  tiles.push({ key: "tasks", node: (
    <KpiTile icon="orders" tone="red" label={manage ? L("Open tasks", "Tugasan terbuka") : L("My open tasks", "Tugasan terbuka saya")} busy={!tasksLoaded}
      value={tf.openTasks.length}
      sub={tf.overdueCount > 0 ? L(`${tf.overdueCount} overdue`, `${tf.overdueCount} lewat`) : L("None overdue", "Tiada yang lewat")}
      onClick={() => go("Tasks")} />
  ) });
  /* the person's own figures fill the row for the roles without the company ones */
  if (tiles.length < 5) {
    const { decide: d, attention } = splitDesk(deskItems);
    tiles.push({ key: "desk", node: (
      <KpiTile icon="pending" tone="navy" label={L("Waiting on me", "Menunggu saya")} busy={desk.data === null}
        value={d.length + attention.length} sub={L(`${d.length} need my decision`, `${d.length} perlu keputusan saya`)} onClick={() => go("Desk")} />
    ) });
  }
  if (tiles.length < 5) {
    tiles.push({ key: "leave", node: (
      <KpiTile icon="holiday" tone="purple" label={L("My leave", "Cuti saya")} value={ownLeave.length}
        sub={ownLeave.length ? L("Waiting for a decision", "Menunggu keputusan") : L("Nothing pending", "Tiada menunggu")}
        onClick={() => go("Leave")} />
    ) });
  }

  /* ---- shared card head ---- */
  const head = (title: string, right?: ReactNode, sub?: string) => (
    <div className={ov.head}>
      <div className={ov.headText}>
        <h3 className={ov.title}>{title}</h3>
        {sub && <p className={ov.sub}>{sub}</p>}
      </div>
      {right}
    </div>
  );
  const viewAll = (onClick: () => void, label = L("View all", "Lihat semua")) => (
    <button type="button" className={ov.viewAll} onClick={onClick}>{label}</button>
  );
  const empty = (icon: AppIconName, text: string) => <p className={ov.empty}><AppIcon name={icon} />{text}</p>;

  /* ---- C1. recent activities (the audit trail), or the company news ---- */
  const activities = Array.isArray(audit) ? audit.filter((a) => !a.action.startsWith("auth.") && !a.action.startsWith("2fa")).slice(0, 5) : [];
  const activityCard = adminTier && audit !== "denied" ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Recent activities", "Aktiviti terkini")}>
      {head(L("Recent Activities", "Aktiviti Terkini"), user.role === "ceo" ? undefined : <Link className={ov.viewAll} href="/admin">{L("Audit log", "Log audit")}</Link>,
        L("What changed across the modules, newest first.", "Apa yang berubah dalam modul, terkini dahulu."))}
      {audit === null ? <SkelRows rows={5} /> : activities.length === 0 ? empty("info", L("Nothing recorded yet.", "Belum ada yang direkodkan.")) : (
        <ul className={ov.rows}>
          {activities.map((a) => {
            const line = auditLine(a);
            return (
              <li key={a.id} className={ov.row}>
                <span className={`${ov.well} ${ov.goldWell}`} aria-hidden><AppIcon name={line.icon} /></span>
                <span className={ov.rowText}><strong>{line.title}</strong>{line.sub && <span>{line.sub}</span>}</span>
                <span className={ov.when}>{ago(a.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  ) : (
    <section className={`${card} ${ov.card}`} aria-label={L("Company news", "Berita syarikat")}>
      {head(L("Company News", "Berita Syarikat"), can("Announcements") ? viewAll(() => go("Announcements")) : undefined, L("The latest announcements.", "Pengumuman terkini."))}
      {!annsKnown ? <SkelRows rows={4} /> : anns.length === 0 ? empty("chat", L("No announcements.", "Tiada pengumuman.")) : (
        <ul className={ov.rows}>
          {anns.slice(0, 5).map((a) => (
            <li key={a.id} className={ov.row}>
              <span className={`${ov.well} ${ov.blueWell}`} aria-hidden><AppIcon name="chat" /></span>
              <span className={ov.rowText}><strong>{a.title}</strong><span>{annCatL(a.category)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- C2. task overview: the Tasks page's own four figures ---- */
  const taskSlices = [
    { key: "closed", label: L("Closed", "Selesai"), value: tf.doneCount, color: "var(--success)" },
    { key: "open", label: L("Open", "Terbuka"), value: openOnly, color: "var(--info)" },
    { key: "pending", label: L("Pending", "Menunggu"), value: tf.pendingCount, color: "var(--warning)" },
  ];
  const pctOf = (n: number) => (tasks.length ? Math.round((n * 100) / tasks.length) : 0);
  const taskCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Task overview", "Gambaran tugasan")}>
      {head(L("Task Overview", "Gambaran Tugasan"), viewAll(() => go("Tasks")), manage ? L("Every task on the board.", "Setiap tugasan pada papan.") : L("Your tasks.", "Tugasan anda."))}
      {!tasksLoaded ? <SkelRows rows={4} /> : tasks.length === 0 ? empty("orders", L("No tasks yet.", "Belum ada tugasan.")) : (
        <div className={ov.donutRow}>
          <Donut size={150} hideLegend centerLabel={String(tasks.length)} centerSub={L("total tasks", "jumlah tugasan")} slices={taskSlices.map(({ label, value, color }) => ({ label, value, color }))} />
          <ul className={ov.legend}>
            {[...taskSlices, { key: "overdue", label: L("Overdue", "Lewat"), value: tf.overdueCount, color: "var(--danger)" }].map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => go("Tasks")}>
                  <span className={ov.dot} style={{ background: s.color }} aria-hidden />
                  <span>{s.label}</span>
                  <strong>{s.value}</strong>
                  <span className={ov.muted}>{pctOf(s.value)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );

  /* ---- C3. sales performance: the month figure and the months behind it ---- */
  const months = (rev?.overall?.months ?? []).slice(-10);
  const maxMonth = Math.max(1, ...months.map((m) => m.cents));
  const salesCard = canRevenue ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Sales performance", "Prestasi jualan")}>
      {head(L("Sales Performance", "Prestasi Jualan"), (can("Ecommerce") || can("Sales")) ? viewAll(() => go(can("Ecommerce") ? "Ecommerce" : "Sales"), L("Open", "Buka")) : undefined,
        rev ? L(`${rev.month.slice(5, 7)}-${rev.month.slice(0, 4)}, every channel`, `${rev.month.slice(5, 7)}-${rev.month.slice(0, 4)}, setiap saluran`) : undefined)}
      {!rev ? <SkelRows rows={5} /> : (
        <>
          <p className={ov.bigMoney}>{sales ? fmtRM(sales.total) : "—"}</p>
          {sales && (
            <p className={sales.delta === null ? ov.muted : sales.delta >= 0 ? ov.up : ov.down}>
              {sales.delta === null ? L("No sales last month to compare with", "Tiada jualan bulan lalu untuk dibandingkan")
                : L(`${sales.delta >= 0 ? "↑" : "↓"} ${Math.abs(sales.delta)}% vs last month (${fmtRM(sales.last)})`, `${sales.delta >= 0 ? "↑" : "↓"} ${Math.abs(sales.delta)}% berbanding bulan lalu (${fmtRM(sales.last)})`)}
            </p>
          )}
          {months.length > 1 ? (
            <>
              <div className={ov.chart} role="img" aria-label={months.map((m) => `${m.month}: ${fmtRM(m.cents)}`).join(", ")}>
                {months.map((m) => (
                  <span key={m.month} className={ov.chartCol} title={`${m.month} · ${fmtRM(m.cents)}`}>
                    <span className={ov.chartTrack}><span className={ov.chartBar} style={{ height: `${Math.max(2, (m.cents / maxMonth) * 100)}%` }} /></span>
                    <span className={ov.chartLabel}>{new Date(`${m.month}-01T00:00:00Z`).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB", { month: "short", timeZone: "UTC" })}</span>
                  </span>
                ))}
              </div>
              <p className={ov.caption}>{L("Bars: every revenue line by month, stokis and ELFIA web orders included — the figure above counts TikTok, invoices, other shipments and manual sales, as the Sales floor does.",
                "Bar: setiap baris hasil mengikut bulan, termasuk stokis dan pesanan web ELFIA — angka di atas mengira TikTok, invois, penghantaran lain dan jualan manual, seperti lantai jualan.")}</p>
            </>
          ) : empty("chart", L("Monthly history appears after the second month of sales.", "Sejarah bulanan muncul selepas bulan jualan kedua."))}
        </>
      )}
    </section>
  ) : null;

  /* ---- D1. live sessions (the roster): what the reference called campaigns ---- */
  const upcomingLives = (sessions ?? []).filter((s) => s.status === "scheduled" && s.session_date >= today).slice(0, 4);
  const livesCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Live sessions", "Sesi live")}>
      {head(L("Live Sessions", "Sesi Live"), can("Attendance") ? viewAll(() => go("Attendance")) : undefined,
        manage ? L("Upcoming lives on the roster.", "Live akan datang dalam roster.") : L("Your upcoming lives.", "Live anda akan datang."))}
      {sessions === null ? <SkelRows rows={3} /> : upcomingLives.length === 0 ? empty("live", L("No live session is scheduled.", "Tiada sesi live dijadualkan.")) : (
        <ul className={ov.rows}>
          {upcomingLives.map((s) => (
            <li key={s.id} className={ov.row}>
              <span className={`${ov.well} ${ov.redWell}`} aria-hidden><AppIcon name="live" /></span>
              <span className={ov.rowText}>
                <strong>{s.client_company ?? s.client_name ?? L("Live session", "Sesi live")}</strong>
                <span>{[s.host_name, s.notes].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={ov.rowEnd}>
                <span className={s.session_date === today ? chipGold : chipNeutral}>{s.session_date === today ? L("Today", "Hari ini") : dmy(s.session_date)}</span>
                <span className={ov.when}>{s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {s.platform}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- D2. team on shift (the managing roles), or your own shift ---- */
  const shiftCard = manage ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Team on shift", "Pasukan sedang syif")}>
      {head(L("Team On Shift", "Pasukan Sedang Syif"), can("Attendance") ? viewAll(() => go("Attendance"), L("View attendance", "Lihat kehadiran")) : undefined)}
      {monitor === null ? <SkelRows rows={4} /> : (
        <>
          <p className={ov.ratio}><strong>{onShift.length}</strong><span>/ {monitor.length}</span><em>{L("staff on shift now", "kakitangan sedang syif")}</em></p>
          {onShift.length === 0 ? empty("time", L("Nobody is clocked in right now.", "Tiada siapa daftar masuk sekarang.")) : (
            <ul className={ov.rows}>
              {onShift.slice(0, 5).map((m) => (
                <li key={m.id} className={ov.row}>
                  <Avatar name={m.name} size="md" />
                  <span className={ov.rowText}><strong>{m.name}</strong><span className={ov.cap}>{m.role.replace(/_/g, " ")}</span></span>
                  <span className={ov.rowEnd}>
                    <span className={chipSuccess}>{L("On shift", "Sedang syif")}</span>
                    {m.in_at && <span className={ov.when}>{L(`in ${mytHm(m.in_at)}`, `masuk ${mytHm(m.in_at)}`)}</span>}
                  </span>
                </li>
              ))}
              {onShift.length > 5 && <li className={ov.more}>{L(`and ${onShift.length - 5} more`, `dan ${onShift.length - 5} lagi`)}</li>}
            </ul>
          )}
        </>
      )}
    </section>
  ) : todayShift ? (
    /* v1.229.0 (the owner, 30-10-2026: "DASHBOARD TODAY = COMPACT SUMMARY
       ONLY"): the same read-only Today's Shift card My Day draws */
    <div className={ov.card}>{todayShift}</div>
  ) : (
    <section className={`${card} ${ov.card}`} aria-label={L("My shift", "Syif saya")}>
      {head(L("My Shift", "Syif Saya"), viewAll(onOpenShift ?? onOpenDay, L("Open On Shift", "Buka Syif Saya")))}
      {!myShift.known ? <SkelRows rows={2} /> : (
        <div className={ov.myShift}>
          <span className={myShift.open ? chipSuccess : myShift.hasOut ? chipNeutral : chipWarn}>
            {myShift.open ? L(`On shift · since ${myShift.since}`, `Sedang syif · sejak ${myShift.since}`)
              : myShift.hasOut ? L(`Clocked out · ${myShift.since} → ${myShift.out}`, `Daftar keluar · ${myShift.since} → ${myShift.out}`)
              : L("Not clocked in yet", "Belum daftar masuk")}
          </span>
          <p className={ov.sub}>{L("Check in and out on On Shift.", "Daftar masuk dan keluar di Syif Saya.")}</p>
        </div>
      )}
    </section>
  );

  /* ---- D3. upcoming & pending: the desk's decisions, the next deadlines,
     the next company events, your own leave waiting - each opens its tab ---- */
  type Up = { key: string; title: string; sub: string; date: string | null; chip: ReactNode; icon: AppIconName; well: string | undefined; open: () => void };
  const ups: Up[] = [
    ...decide.slice(0, 3).map((d): Up => ({
      key: `d-${d.id}`, title: d.title, sub: d.sub, date: null, icon: "pending", well: ov.goldWell,
      chip: <span className={d.overdue ? chipDanger : chipWarn}>{d.overdue ? L("Overdue", "Lewat") : L("Your decision", "Keputusan anda")}</span>,
      open: () => go(d.tab as TabName),
    })),
    ...tf.openTasks.filter((t) => t.deadline && t.deadline >= today).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).slice(0, 3).map((t): Up => ({
      key: `t-${t.id}`, title: t.title, sub: L("Task", "Tugasan") + (t.assignee ? ` · ${t.assignee}` : ""), date: t.deadline ?? null, icon: "orders", well: ov.blueWell,
      chip: <span className={t.status === "in_progress" ? chipWarn : chipInfo}>{t.status === "in_progress" ? L("Pending", "Menunggu") : L("Open", "Terbuka")}</span>,
      open: () => go("Tasks"),
    })),
    ...(events ?? []).filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, 2).map((e): Up => ({
      key: `e-${e.id}`, title: e.title, sub: [L("Event", "Acara"), e.start_time, e.location].filter(Boolean).join(" · "), date: e.event_date, icon: "date", well: ov.greenWell,
      chip: <span className={chipInfo}>{L("Scheduled", "Dijadualkan")}</span>,
      open: onOpenDay,
    })),
    ...ownLeave.slice(0, 2).map((l): Up => ({
      key: `l-${l.id}`, title: leaveTypeL(l.type), sub: L("My leave request", "Permohonan cuti saya"), date: l.start_date, icon: "holiday", well: ov.redWell,
      chip: <span className={chipWarn}>{L("Pending", "Menunggu")}</span>,
      open: () => go("Leave"),
    })),
  ];
  const upLoaded = desk.data !== null && tasksLoaded && events !== null;
  const upcomingCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Upcoming and pending", "Akan datang dan menunggu")}>
      {head(L("Upcoming & Pending", "Akan Datang & Menunggu"), viewAll(() => go("Desk"), L("Open the Desk", "Buka Meja")))}
      {!upLoaded ? <SkelRows rows={5} /> : ups.length === 0 ? empty("success", L("Nothing waiting and nothing coming up.", "Tiada yang menunggu dan tiada yang akan datang.")) : (
        <ul className={ov.rows}>
          {ups.slice(0, 6).map((u) => (
            <li key={u.key}>
              <button type="button" className={`${ov.row} ${ov.rowBtn}`} onClick={u.open}>
                <span className={`${ov.well} ${u.well}`} aria-hidden><AppIcon name={u.icon} /></span>
                <span className={ov.rowText}><strong>{u.title}</strong><span>{u.sub}</span></span>
                <span className={ov.rowEnd}>{u.chip}{u.date && <span className={ov.when}>{dmy(u.date)}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- E1. quick actions: each opens an existing workflow, only where this person may go ---- */
  const actions: { key: string; icon: AppIconName; label: string; on: () => void; show: boolean }[] = [
    { key: "quote", icon: "document", label: L("Create quotation", "Cipta sebut harga"), on: () => (onCreateQuotation ? onCreateQuotation() : go("Sales")), show: can("Sales") },
    { key: "task", icon: "orders", label: L("Create task", "Cipta tugasan"), on: () => (openAt ? openAt("Tasks", "create") : go("Tasks")), show: can("Tasks") },
    { key: "leave", icon: "holiday", label: L("Apply leave", "Mohon cuti"), on: () => (openAt ? openAt("Leave", "apply") : go("Leave")), show: can("Leave") },
    { key: "claim", icon: "receipt", label: L("Submit claim", "Hantar tuntutan"), on: () => (openAt ? openAt("Claims", "submit") : go("Claims")), show: can("Claims") },
    /* v1.229.0 - the punch lives on On Shift; the shortcut goes there */
    { key: "clock", icon: "time", label: myShift.open ? L("Check out", "Daftar keluar") : L("Check in", "Daftar masuk"), on: onOpenShift ?? onOpenDay, show: true },
    { key: "desk", icon: "pending", label: L("Open the Desk", "Buka Meja"), on: () => go("Desk"), show: can("Desk") },
    { key: "hotels", icon: "store", label: L("Hotel outreach", "Jangkauan hotel"), on: () => go("Hotels"), show: can("Hotels") },
    { key: "staff", icon: "users", label: L("Staff directory", "Direktori kakitangan"), on: () => go("Staff Details"), show: can("Staff Details") },
  ];
  const quickCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Quick actions", "Tindakan pantas")}>
      {head(L("Quick Actions", "Tindakan Pantas"))}
      <ul className={ov.actions}>
        {actions.filter((a) => a.show).slice(0, 8).map((a) => (
          <li key={a.key}>
            <button type="button" className={ov.action} onClick={a.on}>
              <AppIcon name={a.icon} />
              <span>{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  /* ---- E2. the business summary (in place of "module usage", which the
     portal does not measure): the counts the worker gives this person ---- */
  const sumRows: { key: string; label: string; n: number; tab: TabName; warn: boolean }[] = [];
  const addSum = (key: keyof DashSummary, label: string, tab: TabName, warnFrom = 1) => {
    const v = sum?.[key];
    if (typeof v === "number" && can(tab)) sumRows.push({ key, label, n: v, tab, warn: v >= warnFrom });
  };
  addSum("pending_leave", L("Leave waiting for a decision", "Cuti menunggu keputusan"), "Leave");
  addSum("pending_claims", L("Claims waiting for a decision", "Tuntutan menunggu keputusan"), "Claims");
  addSum("pending_ot", L("Overtime to approve", "OT untuk diluluskan"), "Attendance");
  addSum("outstanding_invoices", L("Unpaid invoices", "Invois belum dibayar"), "Sales");
  addSum("low_stock", L("Items low on stock", "Item stok rendah"), "Inventory");
  addSum("lives_today", L("Live sessions today", "Sesi live hari ini"), "Attendance", 9999);
  addSum("clients", L("Clients on file", "Pelanggan dalam rekod"), "Sales", 999999);
  const maxSum = Math.max(1, ...sumRows.map((r) => r.n));
  const summaryCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Business summary", "Ringkasan perniagaan")}>
      {head(L("Business Summary", "Ringkasan Perniagaan"), undefined, L("Counts from the modules, as you may see them.", "Kiraan daripada modul, mengikut akses anda."))}
      {sumView.loading && !sum ? <SkelRows rows={5} /> : sumRows.length === 0 ? empty("info", L("No company figures for your role.", "Tiada angka syarikat untuk peranan anda.")) : (
        <ul className={ov.bars}>
          {sumRows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => go(r.tab)}>
                <span>{r.label}</span>
                <span className={ov.track}><span className={`${ov.fill} ${r.warn ? ov.fillWarn : ""}`} style={{ width: `${Math.max(r.n ? 4 : 0, (r.n / maxSum) * 100)}%` }} /></span>
                <strong>{r.n}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- E3. system status: what the worker can actually say (CEO, admin) ---- */
  const backupAge = health && health !== "denied" && health.last_backup ? Math.floor((nowMs - new Date(health.last_backup.uploaded).getTime()) / 86_400_000) : null;
  const errors24 = health && health !== "denied" ? health.errors.filter((e) => nowMs - new Date(e.created_at.replace(" ", "T") + "Z").getTime() < 86_400_000).length : 0;
  const statusRow = (label: string, ok: boolean | null, chip: string, detail: string) => (
    <li className={ov.statusRow}>
      <span className={`${ov.statusDot} ${ok === null ? ov.dotGrey : ok ? ov.dotGreen : ov.dotAmber}`} aria-hidden />
      <span className={ov.rowText}><strong>{label}</strong><span>{detail}</span></span>
      <span className={ok === null ? chipNeutral : ok ? chipSuccess : chipWarn}>{chip}</span>
    </li>
  );
  const statusCard = adminTier && health !== "denied" ? (
    <section className={`${card} ${ov.card}`} aria-label={L("System status", "Status sistem")}>
      {head(L("System Status", "Status Sistem"), user.role !== "ceo" ? <Link className={ov.viewAll} href="/admin">{L("Open admin", "Buka admin")}</Link> : undefined,
        L("What the portal can check. Uptime is not measured here.", "Apa yang portal boleh semak. Masa operasi tidak diukur di sini."))}
      {health === null ? <SkelRows rows={4} /> : (
        <ul className={ov.rows}>
          {statusRow(L("Portal & API", "Portal & API"), true, L("Answering", "Menjawab"), L("This page just read from it", "Halaman ini baru membacanya"))}
          {statusRow(L("Database", "Pangkalan data"), (health.migrations_pending ?? []).length === 0,
            (health.migrations_pending ?? []).length === 0 ? L("Up to date", "Terkini") : L(`${health.migrations_pending!.length} pending`, `${health.migrations_pending!.length} tertunda`),
            (health.migrations_pending ?? []).length === 0 ? L("Every migration is applied", "Setiap migrasi telah digunakan") : L("Run the pending migrations, then deploy", "Jalankan migrasi tertunda, kemudian deploy"))}
          {statusRow(L("Backup", "Sandaran"), health.last_backup ? (backupAge ?? 0) <= 2 : false,
            health.last_backup ? (mytStamp(health.last_backup.uploaded).date === today ? L("Today", "Hari ini") : L(`${Math.max(1, backupAge ?? 1)} d ago`, `${Math.max(1, backupAge ?? 1)} h lalu`)) : L("None yet", "Belum ada"),
            health.last_backup ? L(`Last backup ${mytStamp(health.last_backup.uploaded).text}`, `Sandaran terakhir ${mytStamp(health.last_backup.uploaded).text}`) : L("Nightly backups run at 03:20 MYT", "Sandaran malam berjalan pada 03:20 MYT"))}
          {statusRow(L("Errors (24 h)", "Ralat (24 j)"), errors24 === 0, String(errors24),
            health.errors[0] ? L(`Latest ${ago(health.errors[0].created_at)} · ${health.errors[0].source}`, `Terkini ${ago(health.errors[0].created_at)} · ${health.errors[0].source}`) : L("None logged", "Tiada direkodkan"))}
        </ul>
      )}
    </section>
  ) : null;

  return (
    <div className={ov.page}>
      {/* v1.233.0 - A2. the reporting line (the owner's CEO hierarchy brief,
          30-10-2026): Executive Leadership for the CEO, My Reporting Line
          for everyone else, from the Organisation chart's own tree */}
      <ReportingLineCard canOpenOrg={Boolean(canOpen?.("Staff Details"))} openOrg={() => (openAt ? openAt("Staff Details", "org") : go("Staff Details"))} />
      {/* B. the five tiles */}
      <div className={ov.kpis}>
        <KpiRow label={L("At a glance", "Sepintas lalu")}>
          {tiles.slice(0, 5).map((t) => <Fragment key={t.key}>{t.node}</Fragment>)}
        </KpiRow>
      </div>
      {/* C. the main information grid */}
      <div className={ov.grid}>
        {activityCard}
        {taskCard}
        {salesCard}
      </div>
      {/* D. the operational overview (v1.213.0: top-aligned - the third
          column is two cards tall, so the others keep their own height) */}
      <div className={`${ov.grid} ${ov.gridTop}`}>
        {livesCard}
        {shiftCard}
        {/* v1.213.0 - the month's leave applications sit under Upcoming &
            Pending (moved from My Day, the owner, 27-10-2026: one place) */}
        <div className={ov.column}>
          {upcomingCard}
          <LeaveMonthCard go={go} />
        </div>
      </div>
      {/* E. the bottom row */}
      <div className={ov.grid}>
        {quickCard}
        {summaryCard}
        {statusCard}
      </div>
    </div>
  );
}

/** The welcome header: the person's name, the Malaysia date, and where their own shift stands. */
export function WelcomeHeader({ user, lang, myShift, onOpenDay }: { user: User; lang: Lang; myShift: MyShift; onOpenDay: () => void }) {
  const first = (user.name ?? "").trim().split(/\s+/)[0] ?? "";
  return (
    <header className={ov.welcome}>
      <div className={ov.welcomeText}>
        <h2 className={ov.welcomeTitle}>{L(`Welcome back, ${first}`, `Selamat kembali, ${first}`)}</h2>
        <p className={ov.welcomeSub}>{L("Here's what's happening across A2Z Creative Marketing.", "Inilah yang berlaku di A2Z Creative Marketing.")}</p>
      </div>
      <div className={ov.welcomeSide}>
        <p className={ov.welcomeDate}><AppIcon name="date" />{mytTodayLine(lang)}</p>
        {myShift.known && (
          <button type="button" className={`${ov.shiftChip} ${myShift.open ? ov.shiftOn : ""}`} onClick={onOpenDay}
            title={L("Open On Shift to check in or out", "Buka Syif Saya untuk daftar masuk atau keluar")}>
            <span className={ov.statusDot} aria-hidden />
            {myShift.open ? L(`On shift since ${myShift.since}`, `Sedang syif sejak ${myShift.since}`)
              : myShift.hasOut ? L(`Clocked out ${myShift.out}`, `Daftar keluar ${myShift.out}`)
              : L("Not clocked in", "Belum daftar masuk")}
          </button>
        )}
      </div>
    </header>
  );
}

export type { MyShift, MonitorRow, Session };
