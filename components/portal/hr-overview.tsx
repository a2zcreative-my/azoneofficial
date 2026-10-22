"use client";

/* v1.192.0 - THE HR OVERVIEW, laid out as the owner's reference photo:

     five tiles          Total staff · Leave requests (this month) · Claims
                         to decide · Payroll items (overtime days to decide,
                         which feed the payroll) · Training & review (probation
                         reviews due, training this month)
     left column         Pending HR actions (your Desk's HR items, by kind),
                         the month's leave (a donut by status, a bar a week),
                         recent HR activity (reports, letters, training,
                         probation decisions)
     right column        today's schedule (the company calendar), upcoming
                         important dates (holidays, birthdays, probation ends,
                         last days, events - the next 30 days) and the quick
                         actions

   Every figure is read from a route this role already calls; a figure the
   server does not give this role (pending claims, OT, the lifecycle) leaves
   its tile or row out rather than showing a zero. Nothing here writes. The
   personal reads (the lifecycle, birthdays, the month's leave) are fetched
   plainly and never written into the device cache. Leave reasons and types
   are not shown here - counts only. No sample figure from the mockup is
   used anywhere. */

import { useEffect, useMemo, useState } from "react";
import type { DashSummary } from "@/components/portal/dashboard";
import type { CompanyEvent } from "@/components/portal/events";
import { deskAnchor, useDeskData, type DeskItem } from "@/components/portal/one-desk";
import { L, revealAnchor } from "@/components/portal/page-shared";
import type { PeopleTab } from "@/components/portal/people-panel";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmy, mytToday } from "@/lib/format";
import { LETTER_LABEL, type LetterKind } from "@/lib/hr-letters";
import { properName } from "@/lib/names";
import type { TabName } from "@/lib/portal-tabs";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./hr-page.module.css";

export type HrView = "overview" | "reports" | "calendar" | "lifecycle" | "payroll" | "admin";

type LeaveRow = { id: number; name: string; start_date: string; end_date: string; status: string };
type People = {
  today: string;
  joining: { id: number; name: string; joined_on: string; open: string[] }[];
  leaving: { id: number; name: string; left_on: string; open: string[] }[];
  probation: { id: number; name: string; review: { ends_on: string; outcome: string | null } | null }[];
  decided: { id: number; name: string | null; outcome: string; decided_at: string }[];
  letters: { id: number; kind: LetterKind; ref_no: string; issued_on: string; voided_at: string | null; name: string }[];
  training: { id: number; name: string; title: string; on_date: string }[];
  pending_migration?: boolean;
};
type Holiday = { id: number; holiday_date: string; name: string; kind: string };
type Report = { id: number; period: string; report_date: string; author: string };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HR_BUCKETS: readonly DeskItem["bucket"][] = ["leave", "claims", "ot", "punches", "people"];
type Pill = "all" | "leave" | "claims" | "ot" | "people" | "others";
const PILL: [Pill, string, string][] = [
  ["all", "All", "Semua"], ["leave", "Leave", "Cuti"], ["claims", "Claims", "Tuntutan"],
  ["ot", "Overtime", "Lebih masa"], ["people", "People", "Orang"], ["others", "Others", "Lain-lain"],
];
const pillOf = (b: DeskItem["bucket"]): Pill => (b === "leave" || b === "claims" || b === "ot" || b === "people" ? b : "others");
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
/* a stamp "YYYY-MM-DD HH:MM:SS" (UTC) or a plain day -> the Malaysian day */
const mytDay = (s: string | null | undefined) => {
  if (!s) return "";
  if (s.length <= 10) return s;
  const t = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z")).getTime();
  return Number.isNaN(t) ? s.slice(0, 10) : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

/** One plain GET, kept in component state only (never the device cache). */
function usePlain<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; denied: boolean }>({ path: null, data: null, denied: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    void api<T>(path).then((r) => {
      if (live) setState({ path, data: r.ok ? r.data : null, denied: !r.ok });
    });
    return () => { live = false; };
  }, [path]);
  const settled = state.path === path;
  return { data: settled ? state.data : null, done: !path || settled, denied: settled && state.denied };
}

export function HrOverview({ role, admin, go, canOpen, open }: {
  role: string;
  admin: boolean;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
  open: (v: HrView, sub?: PeopleTab) => void;
}) {
  const today = mytToday();
  const year = today.slice(0, 4);
  const sum = useCachedApi<DashSummary>("/staff/dashboard/summary", true, ["leave", "claims", "attendance", "users"]);
  const desk = useDeskData();
  const leave = usePlain<{ month: string; leave: LeaveRow[] }>("/staff/leave/month");
  const people = usePlain<People>(admin ? "/staff/people/overview" : null);
  const events = usePlain<{ events: CompanyEvent[] }>("/staff/events");
  const hol = usePlain<{ holidays: Holiday[] }>(`/staff/holidays?year=${year}`);
  /* the next 30 days may run into January */
  const holNext = usePlain<{ holidays: Holiday[] }>(today.slice(5, 7) === "12" ? `/staff/holidays?year=${Number(year) + 1}` : null);
  const bdays = usePlain<{ birthdays: { name: string; birthday: string }[] }>("/staff/birthdays");
  const reports = usePlain<{ reports: Report[] }>("/staff/task-reports");
  const [pill, setPill] = useState<Pill>("all");

  const p = people.data && !people.data.pending_migration ? people.data : null;
  const s = sum.data;

  /* ---- tiles ---- */
  const leaves = leave.data?.leave ?? [];
  const approved = leaves.filter((l) => l.status === "approved").length;
  const rejected = leaves.filter((l) => l.status === "rejected").length;
  const pending = leaves.length - approved - rejected;
  const horizon = addDays(today, 30);
  const reviewsDue = p ? p.probation.filter((x) => x.review && !x.review.outcome && x.review.ends_on <= horizon).length : 0;
  const trainingMonth = p ? p.training.filter((t) => t.on_date.slice(0, 7) === today.slice(0, 7)).length : 0;
  const openTile = (t: TabName) => (canOpen(t) ? () => go(t) : undefined);

  /* ---- pending HR actions: the Desk's HR buckets ---- */
  const hrItems = useMemo(() => (desk.data?.items ?? []).filter((i) => HR_BUCKETS.includes(i.bucket)), [desk.data]);
  const count = (k: Pill) => (k === "all" ? hrItems.length : hrItems.filter((i) => pillOf(i.bucket) === k).length);
  const actions = (pill === "all" ? hrItems : hrItems.filter((i) => pillOf(i.bucket) === pill)).slice(0, 6);

  /* ---- the month's leave: by status, and a bar a week ---- */
  const leaveMonth = leave.data?.month ?? today.slice(0, 7);
  const weeks = [0, 0, 0, 0, 0];
  for (const l of leaves) {
    const day = l.start_date.slice(0, 7) < leaveMonth ? 1 : Number(l.start_date.slice(8, 10));
    weeks[Math.min(4, Math.floor((day - 1) / 7))]! += 1;
  }
  const wMax = Math.max(1, ...weeks);

  /* ---- recent HR activity ---- */
  type Act = { key: string; day: string; who: string; what: string; module: string; chip: [string, string] };
  const activity: Act[] = (() => {
    const out: Act[] = [];
    for (const r of reports.data?.reports ?? []) {
      out.push({ key: `r${r.id}`, day: r.report_date, who: r.author ?? "-", module: L("Reports", "Laporan"),
        what: L(`${r.period[0]?.toUpperCase() ?? ""}${r.period.slice(1)} task report submitted`, `Laporan tugasan ${r.period === "daily" ? "harian" : r.period === "weekly" ? "mingguan" : "bulanan"} dihantar`),
        chip: [chipSmSuccess, L("Submitted", "Dihantar")] });
    }
    if (p) {
      for (const l of p.letters) out.push({ key: `l${l.id}`, day: l.issued_on, who: l.name, module: L("Letters", "Surat"),
        what: `${L(LETTER_LABEL[l.kind]?.[0] ?? l.kind, LETTER_LABEL[l.kind]?.[1] ?? l.kind)} · ${l.ref_no}`,
        chip: l.voided_at ? [chipSmDanger, L("Voided", "Dibatalkan")] : [chipSmSuccess, L("Issued", "Dikeluarkan")] });
      for (const t of p.training) out.push({ key: `t${t.id}`, day: t.on_date, who: t.name, module: L("Training", "Latihan"),
        what: t.title, chip: [chipSmInfo, L("Recorded", "Direkod")] });
      for (const d of p.decided) out.push({ key: `d${d.id}`, day: mytDay(d.decided_at), who: d.name ?? "-", module: L("Probation", "Percubaan"),
        what: d.outcome === "confirmed" ? L("Probation confirmed", "Percubaan disahkan") : d.outcome === "extended" ? L("Probation extended", "Percubaan dilanjutkan") : L("Employment ended", "Pekerjaan ditamatkan"),
        chip: d.outcome === "confirmed" ? [chipSmSuccess, L("Confirmed", "Disahkan")] : d.outcome === "extended" ? [chipSmWarn, L("Extended", "Dilanjutkan")] : [chipSmDanger, L("Ended", "Ditamatkan")] });
    }
    return out.filter((a) => a.day && a.day <= today).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 6);
  })();

  /* ---- today's schedule ---- */
  const evs = events.data?.events ?? [];
  const holidays = [...(hol.data?.holidays ?? []), ...(holNext.data?.holidays ?? [])];
  const todays = [
    ...holidays.filter((h) => h.holiday_date === today).map((h) => ({ key: `h${h.id}`, time: L("All day", "Sepanjang hari"), title: h.name, sub: L("Holiday", "Cuti"), chip: [chipSmDanger, L("Holiday", "Cuti")] as [string, string] })),
    ...evs.filter((e) => e.event_date === today).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? "")).map((e) => ({
      key: `e${e.id}`, time: e.start_time ? e.start_time.slice(0, 5) : L("All day", "Sepanjang hari"), title: e.title,
      sub: [e.location, e.attendees && e.attendees.length ? L(`${e.attendees.length} required`, `${e.attendees.length} wajib`) : L("Everyone", "Semua")].filter(Boolean).join(" · "),
      chip: [e.category === "training" ? chipSmInfo : e.category === "meeting" ? chipSmWarn : chipSmNeutral, catLabel(e.category)] as [string, string],
    })),
  ];

  /* ---- upcoming important dates: the next 30 days ---- */
  type Dated = { key: string; day: string; title: string; tag: [string, string]; icon: AppIconName };
  const upcoming: Dated[] = (() => {
    const out: Dated[] = [];
    const within = (d: string) => d > today && d <= horizon;
    for (const h of holidays) if (within(h.holiday_date)) out.push({ key: `h${h.id}`, day: h.holiday_date, title: h.name, tag: [chipSmDanger, L("Holiday", "Cuti")], icon: "holiday" });
    for (const b of bdays.data?.birthdays ?? []) {
      const md = b.birthday.slice(5);
      for (const y of [Number(year), Number(year) + 1]) {
        const d = `${y}-${md}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && within(d)) out.push({ key: `b${b.name}${y}`, day: d, title: L(`${properName(b.name)}'s birthday`, `Hari lahir ${properName(b.name)}`), tag: [chipSmSuccess, L("Birthday", "Hari lahir")], icon: "cake" });
      }
    }
    if (p) {
      for (const x of p.probation) if (x.review && !x.review.outcome && within(x.review.ends_on)) out.push({ key: `p${x.id}`, day: x.review.ends_on, title: L(`${x.name}: probation ends`, `${x.name}: percubaan tamat`), tag: [chipSmWarn, L("Probation", "Percubaan")], icon: "verify" });
      for (const u of p.leaving) if (within(u.left_on)) out.push({ key: `x${u.id}`, day: u.left_on, title: L(`${u.name}: last day`, `${u.name}: hari terakhir`), tag: [chipSmNeutral, L("Leaving", "Keluar")], icon: "offboard" });
    }
    for (const e of evs) if (within(e.event_date)) out.push({ key: `e${e.id}`, day: e.event_date, title: e.title, tag: [chipSmInfo, catLabel(e.category)], icon: "date" });
    return out.sort((a, b) => a.day.localeCompare(b.day));
  })();
  const datesDone = hol.done && bdays.done && events.done && people.done;

  /* ---- quick actions: only the doors this account can open ---- */
  const quick: { icon: AppIconName; tone: string | undefined; label: string; show: boolean; onClick: () => void; title?: string }[] = [
    { icon: "success", tone: css.green, label: L("Approve Leave", "Lulus Cuti"), show: canOpen("Leave"), onClick: () => go("Leave") },
    { icon: "receipt", tone: css.gold, label: L("Approve Claims", "Lulus Tuntutan"), show: canOpen("Claims"), onClick: () => { go("Claims"); revealAnchor("claims-pending"); } },
    { icon: "users", tone: css.blue, label: L("Manage Staff", "Urus Kakitangan"), show: canOpen("Staff Details"), onClick: () => go("Staff Details") },
    { icon: "money", tone: css.red, label: L("Process Payroll", "Proses Gaji"), show: canOpen("Payroll"), onClick: () => go("Payroll") },
    { icon: "date", tone: css.blue, label: L("View Calendar", "Lihat Kalendar"), show: true, onClick: () => open("calendar") },
    { icon: "add", tone: css.gold, label: L("Add New Staff", "Tambah Kakitangan"), show: canOpen("Staff Details") && ["super_admin", "admin", "ceo"].includes(role), onClick: () => go("Staff Details"),
      title: L("Opens Staff Details, where Add staff creates the account", "Membuka Butiran Kakitangan, tempat Tambah kakitangan mencipta akaun") },
    { icon: "trophy", tone: css.purple, label: L("Training & Review", "Latihan & Semakan"), show: admin, onClick: () => open("lifecycle", "training") },
    { icon: "chart", tone: css.navy, label: L("HR Reports", "Laporan HR"), show: true, onClick: () => open("reports") },
  ];

  return (
    <>
      <KpiRow label={L("HR at a glance", "HR sepintas lalu")}>
        <KpiTile icon="users" tone="blue" label={L("Total Staff", "Jumlah Kakitangan")}
          value={s?.staff_total ?? 0} busy={!s}
          sub={p ? L(`${p.probation.length} on probation · ${p.leaving.length} leaving`, `${p.probation.length} dalam percubaan · ${p.leaving.length} keluar`) : L("active staff", "kakitangan aktif")}
          onClick={openTile("Staff Details")} title={L("Open Staff Details", "Buka Butiran Kakitangan")} />
        <KpiTile icon="holiday" tone="green" label={L("Leave Requests", "Permohonan Cuti")}
          value={leaves.length} busy={!leave.done}
          sub={leave.done ? L(`this month · ${pending} pending · ${approved} approved`, `bulan ini · ${pending} menunggu · ${approved} diluluskan`) : undefined}
          onClick={openTile("Leave")} title={L("Open Leave", "Buka Cuti")} />
        {(!s || s.pending_claims != null) && (
          <KpiTile icon="receipt" tone="gold" label={L("Claims", "Tuntutan")}
            value={s?.pending_claims ?? 0} busy={!s}
            sub={L("waiting for a decision", "menunggu keputusan")}
            onClick={canOpen("Claims") ? () => { go("Claims"); revealAnchor("claims-pending"); } : undefined} title={L("Open Claims", "Buka Tuntutan")} />
        )}
        {(!s || s.pending_ot != null) && (
          <KpiTile icon="money" tone="red" label={L("Payroll Items", "Item Gaji")}
            value={s?.pending_ot ?? 0} busy={!s}
            sub={(s?.pending_ot ?? 0) > 0 ? L("overtime days to decide · need attention", "hari lebih masa untuk diputuskan · perlu perhatian") : L("no overtime waiting", "tiada lebih masa menunggu")}
            onClick={canOpen("Attendance") ? () => { go("Attendance"); revealAnchor("ot-approvals"); } : undefined} title={L("Overtime approvals, in Attendance", "Kelulusan lebih masa, dalam Kehadiran")} />
        )}
        {admin && !people.denied && (
          <KpiTile icon="trophy" tone="purple" label={L("Training & Review", "Latihan & Semakan")}
            value={reviewsDue} busy={!people.done}
            sub={people.done ? L(`probation reviews due · ${trainingMonth} training this month`, `semakan percubaan · ${trainingMonth} latihan bulan ini`) : undefined}
            onClick={() => open("lifecycle", "probation")} title={L("Open probation", "Buka percubaan")} />
        )}
      </KpiRow>

      <div className={css.split}>
        <div className={css.col}>
          {/* ---- pending HR actions ---- */}
          <section className={card} aria-label={L("Pending HR actions", "Tindakan HR menunggu")}>
            <div className={css.head}>
              <div className={css.lead}>
                <span className={`${css.well} ${css.gold}`}><AppIcon name="pending" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Pending HR Actions", "Tindakan HR Menunggu")}</p>
                  <p className={css.sub}>{L("The HR items on your Desk - leave, claims, overtime, punches and people.", "Item HR di Meja anda - cuti, tuntutan, lebih masa, punch dan orang.")}</p>
                </div>
              </div>
              {canOpen("Desk") && <button type="button" className={btnSm} onClick={() => go("Desk")}>{L("View all", "Lihat semua")}</button>}
            </div>
            <div className={css.pills} role="group" aria-label={L("Filter by kind", "Tapis mengikut jenis")}>
              {PILL.map(([k, en, ms]) => (
                <button key={k} type="button" className={pill === k ? tabPillOn : tabPill} aria-pressed={pill === k} onClick={() => setPill(k)}>
                  {L(en, ms)} ({desk.data ? count(k) : "…"})
                </button>
              ))}
            </div>
            {!desk.data ? <SkelRows rows={4} /> : actions.length === 0 ? (
              <p className={css.empty}>{pill === "all" ? L("Nothing waiting - every HR decision is answered.", "Tiada yang menunggu - setiap keputusan HR sudah dijawab.") : L("Nothing of this kind is waiting.", "Tiada jenis ini yang menunggu.")}</p>
            ) : (
              <ul className={css.actionsList}>
                {actions.map((i) => (
                  <li key={i.id} className={css.action}>
                    <Avatar name={properName(i.who ?? i.title)} size="sm" />
                    <span className={css.actText}>
                      <span className={css.rowName}>{i.who ? properName(i.who) : i.title}</span>
                      <span className={css.sub}>{i.who ? (i.title.startsWith(`${i.who} — `) ? i.title.slice(i.who.length + 3) : i.title) : i.sub}</span>
                    </span>
                    <span className={css.actWhen}>{i.since ? dmy(mytDay(i.since)) : ""}</span>
                    <span className={i.overdue ? chipSmDanger : chipSmWarn}>{i.overdue ? L("Overdue", "Lewat") : L("Pending", "Menunggu")}</span>
                    <button type="button" className={btnSm} onClick={() => { go(i.tab as TabName); revealAnchor(deskAnchor(i.bucket)); }}
                      title={L(`Open in ${i.tab}`, `Buka dalam ${i.tab}`)}>{L("View", "Lihat")}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- the month's leave ---- */}
          <section className={card} aria-label={L("Leave overview", "Gambaran cuti")}>
            <div className={css.head}>
              <div className={css.lead}>
                <span className={`${css.well} ${css.green}`}><AppIcon name="holiday" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Leave Overview", "Gambaran Cuti")} <span className={css.muted}>({L("This Month", "Bulan Ini")})</span></p>
                  <p className={css.sub}>{L("Applications touching this month, by status. Cancelled ones are left out.", "Permohonan yang menyentuh bulan ini, mengikut status. Yang dibatalkan tidak dikira.")}</p>
                </div>
              </div>
              {canOpen("Leave") && <button type="button" className={btnSm} onClick={() => go("Leave")}>{L("View leave", "Lihat cuti")}</button>}
            </div>
            {!leave.done ? <SkelRows rows={3} /> : leaves.length === 0 ? (
              <p className={css.empty}>{L("No leave applications this month.", "Tiada permohonan cuti bulan ini.")}</p>
            ) : (
              <div className={css.leaveGrid}>
                <Donut size={132} centerLabel={String(leaves.length)} centerSub={L("requests", "permohonan")} slices={[
                  { label: L("Approved", "Diluluskan"), value: approved, color: "var(--success)" },
                  { label: L("Pending", "Menunggu"), value: pending, color: "var(--warning)" },
                  { label: L("Rejected", "Ditolak"), value: rejected, color: "var(--danger)" },
                ]} />
                <div className={css.trend}>
                  <p className={css.trendTitle}>{L("Leave by week", "Cuti mengikut minggu")}</p>
                  <div className={css.bars} role="img" aria-label={weeks.map((n, i) => `${L("Week", "Minggu")} ${i + 1}: ${n}`).join(", ")}>
                    {weeks.map((n, i) => (
                      <span key={i} className={css.barCol}>
                        <span className={css.barNum}>{n}</span>
                        <span className={css.barTrack}><span className={css.bar} style={{ height: `${Math.round((n / wMax) * 100)}%` }} /></span>
                        <span className={css.barLabel}>{L(`W${i + 1}`, `M${i + 1}`)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ---- recent HR activity ---- */}
          <section className={card} aria-label={L("Recent HR activity", "Aktiviti HR terkini")}>
            <div className={css.head}>
              <div className={css.lead}>
                <span className={`${css.well} ${css.blue}`}><AppIcon name="time" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Recent Activities", "Aktiviti Terkini")}</p>
                  <p className={css.sub}>{admin ? L("Task reports, letters, training and probation decisions, newest first.", "Laporan tugasan, surat, latihan dan keputusan percubaan, terbaru dahulu.") : L("Task reports submitted, newest first.", "Laporan tugasan dihantar, terbaru dahulu.")}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open(admin ? "lifecycle" : "reports")}>{L("View all", "Lihat semua")}</button>
            </div>
            <div className={css.tWrap}>
              <table className={css.t}>
                <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Staff", "Kakitangan")}</th><th>{L("Activity", "Aktiviti")}</th><th>{L("Module", "Modul")}</th><th>{L("Status", "Status")}</th></tr></thead>
                <tbody>
                  {!(reports.done && people.done) ? (
                    <tr><td colSpan={5}><SkelRows rows={4} /></td></tr>
                  ) : activity.length === 0 ? (
                    <tr><td colSpan={5} className={css.empty}>{L("No HR activity recorded yet.", "Belum ada aktiviti HR direkod.")}</td></tr>
                  ) : activity.map((a) => (
                    <tr key={a.key}>
                      <td className={css.muted}>{dmy(a.day)}</td>
                      <td><span className={css.who}><Avatar name={properName(a.who)} size="sm" /><span className={css.rowName}>{properName(a.who)}</span></span></td>
                      <td className={css.wrapCell}>{a.what}</td>
                      <td className={css.muted}>{a.module}</td>
                      <td><span className={a.chip[0]}>{a.chip[1]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className={css.col}>
          {/* ---- today's schedule ---- */}
          <section className={card} aria-label={L("Today's schedule", "Jadual hari ini")}>
            <div className={css.head}>
              <div className={css.lead}>
                <span className={`${css.well} ${css.navy}`}><AppIcon name="date" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Today's Schedule", "Jadual Hari Ini")}</p>
                  <p className={css.sub}>{dmy(today)}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open("calendar")}>{L("View calendar", "Lihat kalendar")}</button>
            </div>
            {!(events.done && hol.done) ? <SkelRows rows={3} /> : todays.length === 0 ? (
              <p className={css.empty}>{L("Nothing on the company calendar today.", "Tiada apa-apa dalam kalendar syarikat hari ini.")}</p>
            ) : (
              <ul className={css.rows}>
                {todays.map((t) => (
                  <li key={t.key} className={css.sched}>
                    <span className={css.schedTime}>{t.time}</span>
                    <span className={css.actText}><span className={css.rowName}>{t.title}</span><span className={css.sub}>{t.sub}</span></span>
                    <span className={t.chip[0]}>{t.chip[1]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- upcoming important dates ---- */}
          <section className={card} aria-label={L("Upcoming important dates", "Tarikh penting akan datang")}>
            <div className={css.head}>
              <div className={css.lead}>
                <span className={`${css.well} ${css.red}`}><AppIcon name="calendarAdd" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Upcoming Important Dates", "Tarikh Penting Akan Datang")}</p>
                  <p className={css.sub}>{L("The next 30 days", "30 hari akan datang")}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open("calendar")}>{L("View all", "Lihat semua")}</button>
            </div>
            {!datesDone ? <SkelRows rows={4} /> : upcoming.length === 0 ? (
              <p className={css.empty}>{L("No holidays, birthdays or deadlines in the next 30 days.", "Tiada cuti, hari lahir atau tarikh akhir dalam 30 hari akan datang.")}</p>
            ) : (
              <ul className={css.rows}>
                {upcoming.slice(0, 7).map((d) => {
                  const n = daysUntil(today, d.day);
                  return (
                    <li key={d.key} className={css.dated}>
                      <span className={css.badge} aria-hidden>
                        <span className={css.badgeDay}>{d.day.slice(8, 10)}</span>
                        <span className={css.badgeMon}>{MON[Number(d.day.slice(5, 7)) - 1]}</span>
                      </span>
                      <span className={css.actText}>
                        <span className={css.rowName}>{d.title}</span>
                        <span className={css.sub}>{n === 1 ? L("Tomorrow", "Esok") : L(`In ${n} days`, `Dalam ${n} hari`)}</span>
                      </span>
                      <span className={d.tag[0]}>{d.tag[1]}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ---- quick actions ---- */}
          <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
            <p className={css.title}>{L("Quick Actions", "Tindakan Pantas")}</p>
            <div className={css.quick}>
              {quick.filter((q) => q.show).map((q) => (
                <button key={q.label} type="button" className={css.qa} onClick={q.onClick} title={q.title}>
                  <span className={`${css.qaIcon} ${q.tone}`}><AppIcon name={q.icon} /></span>
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function catLabel(c: string): string {
  switch (c) {
    case "training": return L("Training", "Latihan");
    case "class": return L("Class", "Kelas");
    case "meeting": return L("Meeting", "Mesyuarat");
    default: return L("Event", "Acara");
  }
}
