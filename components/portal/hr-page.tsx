"use client";

/* v1.192.0 - THE HR PAGE, TABBED (the owner's brief and reference photo,
   22-10-2026: "Replace the long scrolling page with organized tabs"). The
   six tabs are his written brief's; the photo's own row (Requests, Staff,
   Leave, Claims, Payroll ...) would have drawn the Staff, Leave, Claims and
   Payroll modules a second time, which the same brief rules out, so those
   are links here, never copies.

     Overview             the photo's overview (hr-overview.tsx): five tiles,
                          pending HR actions, the month's leave, recent HR
                          activity, today's schedule, upcoming dates, quick
                          actions                                  every HR role
     Reports              the task report: submit, and the management list
                          (POST task_reports, GET task_reports | exec_view)
     Calendar & Holidays  public / company / replacement holidays (add and
                          remove, the auto Monday rule - hr_manage), the
                          company events calendar (its own events_manage
                          gate) and the staff birthdays
     Employee Lifecycle   joining & leaving, probation, letters, training
                          (PeoplePanel, hr_manage)
     Payroll & Payslips   the attendance + leave summary for a person and a
                          month, printable (payroll_export; shown, as before,
                          to the four roles that saw HR Administration)
     HR Administration    where every existing HR control lives, and what
                          this account may do - links only

   WHAT DID NOT CHANGE. No route, table or rule. Every card is the card it
   was: the holiday and payslip cards are HrAdminPanel's two halves
   (hr-admin-panel.tsx, the admin page still shows both), PeoplePanel is
   untouched but for who holds its pill, the task report keeps its submit,
   its failure message and its list. The client gates are the ones the page
   had - ADMIN below is the `administration` list page.tsx used - and the
   worker enforces every route. A tab is mounted the first time it is opened
   and then stays mounted, hidden, so a half-typed report survives a look at
   the calendar. */

import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { useCallback, useEffect, useState } from "react";
import { HolidaysCard, PayslipCard } from "@/components/admin/hr-admin-panel";
import { UpcomingEventsCard } from "@/components/portal/events";
import { HrOverview, type HrView } from "@/components/portal/hr-overview";
import { L, type User } from "@/components/portal/page-shared";
import { PeoplePanel, type PeopleTab } from "@/components/portal/people-panel";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import { Skel, SkelText } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import type { TabName } from "@/lib/portal-tabs";
import { btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmSuccess, fieldLabel, inputClassSm, selectClassSm, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./hr-page.module.css";

/* the roles that saw HR Administration before (page.tsx, v1.173.0) - the
   same four as hr_manage in worker/src/permissions.ts */
export const HR_ADMIN_ROLES = ["hr_admin", "ceo", "super_admin", "admin"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];

export function HrPage({ user, go, canOpen }: {
  user: User;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
}) {
  const admin = HR_ADMIN_ROLES.includes(user.role);
  const [view, setView] = useState<HrView>("overview");
  const [seen, setSeen] = useState<readonly HrView[]>(["overview"]);
  const [people, setPeople] = useState<PeopleTab>("lifecycle");

  const open = useCallback((v: HrView, sub?: PeopleTab) => {
    setView(v);
    setSeen((s) => (s.includes(v) ? s : [...s, v]));
    if (sub) setPeople(sub);
  }, []);

  const tabs: readonly (readonly [HrView, string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["reports", L("Reports", "Laporan")],
    ["calendar", L("Calendar & Holidays", "Kalendar & Cuti Umum")],
    ...(admin ? ([
      ["lifecycle", L("Employee Lifecycle", "Kitaran Pekerja")],
      ["payroll", L("Payroll & Payslips", "Gaji & Slip Gaji")],
    ] as const) : []),
    ["admin", L("HR Administration", "Pentadbiran HR")],
  ];
  const [y, m] = mytToday().split("-").map(Number) as [number, number];
  const month = `${L(MONTHS[m - 1] ?? "", MONTHS_MS[m - 1] ?? "")} ${y}`;
  const has = (v: HrView) => seen.includes(v);

  return (
    <TabPage className={css.page}>
      <LineTabs value={view} onChange={(k) => open(k)} tabs={tabs} label={L("HR", "HR")}
        aside={
          <TabAside>
            <TabPeriod>{month}</TabPeriod>
            <TabAction icon="edit" onClick={() => { open("reports"); requestAnimationFrame(() => document.getElementById("hr-report-text")?.focus()); }}>
              {L("Submit report", "Hantar laporan")}
            </TabAction>
          </TabAside>
        } />

      <div hidden={view !== "overview"} className={css.body}>
        <HrOverview role={user.role} admin={admin} go={go} canOpen={canOpen} open={open} />
      </div>

      {has("reports") && (
        <div hidden={view !== "reports"} className={css.body}>
          <TabZone label={L("Task reports", "Laporan tugasan")} hint={L("Daily, weekly and monthly reports - submitted here, read by management.", "Laporan harian, mingguan dan bulanan - dihantar di sini, dibaca oleh pengurusan.")}>
            <TaskReports />
          </TabZone>
        </div>
      )}

      {has("calendar") && (
        <div hidden={view !== "calendar"} className={css.body}>
          <TabZone label={L("Public & replacement holidays", "Cuti umum & gantian")}>
            {admin ? <HolidaysCard /> : <PermissionPlaceholder title={L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")} />}
          </TabZone>
          <TabZone label={L("Company calendar & events", "Kalendar & acara syarikat")} hint={L("Trainings, classes, meetings and events - the same calendar the Dashboard shows.", "Latihan, kelas, mesyuarat dan acara - kalendar yang sama di Dashboard.")}>
            <div className={css.split2}>
              <UpcomingEventsCard role={user.role} />
              <Birthdays />
            </div>
          </TabZone>
        </div>
      )}

      {admin && has("lifecycle") && (
        <div hidden={view !== "lifecycle"} className={css.body}>
          {/* PeoplePanel draws its own captioned zone and its four pills:
              Joining & leaving, Probation, Letters, Training */}
          <PeoplePanel tab={people} onTab={setPeople} />
          {canOpen("Staff Details") && (
            <p className={css.linkLine}>
              <AppIcon name="info" />
              {L("Employee records, documents and the joining checklist are kept in Staff Details.", "Rekod pekerja, dokumen dan senarai semak kemasukan disimpan di Butiran Kakitangan.")}
              <button type="button" className={btnSm} onClick={() => go("Staff Details")}>{L("Open Staff Details", "Buka Butiran Kakitangan")}</button>
            </p>
          )}
        </div>
      )}

      {admin && has("payroll") && (
        <div hidden={view !== "payroll"} className={css.body}>
          <TabZone label={L("Payslip & payroll summary", "Slip gaji & ringkasan gaji")} hint={L("Choose a person and a month; Print gives the one-page summary payroll works from.", "Pilih orang dan bulan; Cetak memberi ringkasan satu halaman untuk gaji.")}>
            <PayslipCard />
          </TabZone>
          {canOpen("Payroll") && (
            <TabZone label={L("Payroll runs", "Larian gaji")}>
              <LinkCard icon="money" title={L("Salaries, statutory deductions and the monthly run", "Gaji, potongan berkanun dan larian bulanan")}
                text={L("Payroll is its own module - the run, its figures and its exports stay there.", "Gaji ialah modul tersendiri - larian, angka dan eksportnya kekal di sana.")}
                action={L("Open Payroll", "Buka Gaji")} onClick={() => go("Payroll")} />
            </TabZone>
          )}
        </div>
      )}

      {has("admin") && (
        <div hidden={view !== "admin"} className={css.body}>
          <HrAdministration role={user.role} admin={admin} go={go} canOpen={canOpen} open={open} />
        </div>
      )}
    </TabPage>
  );
}

/* ================= Reports ================= */

type Report = { id: number; period: string; report_date: string; content: string; author: string };
type Period = "all" | "daily" | "weekly" | "monthly";
const PERIOD: Record<string, [string, string]> = { daily: ["Daily", "Harian"], weekly: ["Weekly", "Mingguan"], monthly: ["Monthly", "Bulanan"] };
const PAGE = 10;

/** The task report (v1.4.x, HrPanel until v1.192.0): the submit form and
    the list management reads. Submit, its draft-keeping failure and the
    list are as they were; the list gained a period filter and shows more
    than five. */
function TaskReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [draft, setDraft] = useState({
    period: "daily",
    report_date: mytToday(),
    content: "",
  });
  /* v1.152.2 - a report longer than two lines could not be read at all. */
  const [openReport, setOpenReport] = useState<number | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands */
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  /* a submit bumps the tick; the list is set from the promise, never
     synchronously from the effect */
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void api<{ reports: Report[] }>(`/staff/task-reports`).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setReports(r.data.reports);
      if (r.status === 403) setDenied(true);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [tick]);

  const submitReport = async () => {
    if (!draft.content.trim()) return;
    /* v1.40.0 (AUDIT M14): a failed submit KEEPS the draft and says why. */
    setBusy(true);
    const res = await api<{ error?: { message?: string } }>(`/staff/task-reports`, { method: "POST", body: JSON.stringify(draft) });
    setBusy(false);
    if (!res.ok) {
      window.alert(res.data?.error?.message ?? L("Report was not saved — you may not have access to task reports.", "Laporan tidak disimpan — anda mungkin tiada akses kepada laporan tugasan."));
      return;
    }
    setDraft((d) => ({ ...d, content: "" }));
    load();
  };

  const count = (p: Period) => (p === "all" ? reports.length : reports.filter((r) => r.period === p).length);
  const list = period === "all" ? reports : reports.filter((r) => r.period === period);

  return (
    <div className={css.split}>
      <section className={card} aria-label={L("Task report", "Laporan tugasan")}>
        <div className={css.head}>
          <div className={css.lead}>
            <span className={`${css.well} ${css.gold}`}><AppIcon name="edit" /></span>
            <div className={css.headText}>
              <p className={css.title}>{L("Task report", "Laporan tugasan")}</p>
              <p className={css.sub}>{L("Daily, weekly, or monthly — visible to management.", "Harian, mingguan atau bulanan — dilihat oleh pengurusan.")}</p>
            </div>
          </div>
        </div>
        <div className={css.form}>
          <label className={css.field}><span className={fieldLabel}>{L("Period", "Tempoh")}</span>
            <select className={selectClassSm} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))}>
              <option value="daily">{L("Daily", "Harian")}</option>
              <option value="weekly">{L("Weekly", "Mingguan")}</option>
              <option value="monthly">{L("Monthly", "Bulanan")}</option>
            </select>
          </label>
          <label className={css.field}><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
            <input type="date" className={inputClassSm} value={draft.report_date} onChange={(e) => setDraft((d) => ({ ...d, report_date: e.target.value }))} />
          </label>
        </div>
        <label className={css.fieldFull}><span className={fieldLabel}>{L("Report", "Laporan")}</span>
          <textarea id="hr-report-text" className={`${inputClassSm} ${css.textarea}`} rows={6}
            placeholder={L("What was completed, what is pending, what needs attention…", "Apa yang telah siap, apa yang tertunda, apa yang perlu perhatian…")}
            value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
        </label>
        <div className={css.actions}>
          <button type="button" className={btnSmPrimary} disabled={busy || !draft.content.trim()} onClick={() => void submitReport()}>
            {busy ? L("Submitting…", "Menghantar…") : L("Submit report", "Hantar laporan")}
          </button>
        </div>
      </section>

      <section className={card} aria-label={L("Submitted reports", "Laporan dihantar")}>
        <div className={css.head}>
          <div className={css.lead}>
            <span className={`${css.well} ${css.blue}`}><AppIcon name="documents" /></span>
            <div className={css.headText}>
              <p className={css.title}>{L("Submitted reports", "Laporan dihantar")}</p>
              <p className={css.sub}>{L("The latest 100, newest first. Press a report to read all of it.", "100 terkini, terbaru dahulu. Tekan laporan untuk membaca semuanya.")}</p>
            </div>
          </div>
        </div>
        <div className={css.pills} role="group" aria-label={L("Filter by period", "Tapis mengikut tempoh")}>
          {(["all", "daily", "weekly", "monthly"] as const).map((p) => (
            <button key={p} type="button" className={period === p ? tabPillOn : tabPill} aria-pressed={period === p}
              onClick={() => { setPeriod(p); setShown(PAGE); }}>
              {p === "all" ? L("All", "Semua") : L(PERIOD[p]![0], PERIOD[p]![1])} ({loaded ? count(p) : "…"})
            </button>
          ))}
        </div>
        <ul className={css.reports}>
          {!loaded && Array.from({ length: 3 }, (_, i) => (
            <li key={`skel-${i}`} className={css.report} aria-hidden>
              <Skel className={css.skelLine} />
              <SkelText lines={2} />
            </li>
          ))}
          {loaded && denied && <li className={css.empty}>{L("Task reports are for HR and management.", "Laporan tugasan untuk HR dan pengurusan.")}</li>}
          {loaded && !denied && list.length === 0 && (
            <li className={css.empty}>{period === "all" ? L("No reports yet - the first one you submit appears here.", "Belum ada laporan - yang pertama anda hantar dipaparkan di sini.") : L("No reports for this period.", "Tiada laporan untuk tempoh ini.")}</li>
          )}
          {list.slice(0, shown).map((r) => (
            <li key={r.id} className={css.report}>
              <button type="button" className={css.reportBtn} aria-expanded={openReport === r.id}
                title={openReport === r.id ? L("Collapse", "Kecilkan") : L("Read the whole report", "Baca seluruh laporan")}
                onClick={() => setOpenReport((o) => (o === r.id ? null : r.id))}>
                <span className={css.reportHead}>
                  <span className={r.period === "monthly" ? chipSmInfo : r.period === "weekly" ? chipSmSuccess : chipSmNeutral}>{PERIOD[r.period] ? L(PERIOD[r.period]![0], PERIOD[r.period]![1]) : r.period}</span>
                  <span className={css.reportMeta}>{dmy(r.report_date)} · {r.author}</span>
                </span>
                <span className={`${css.reportText} ${openReport === r.id ? "" : css.clamp}`}>{r.content}</span>
              </button>
            </li>
          ))}
        </ul>
        {list.length > shown && (
          <div className={css.actions}>
            <button type="button" className={btnSm} onClick={() => setShown((n) => n + PAGE)}>{L(`Show more (${list.length - shown})`, `Tunjuk lagi (${list.length - shown})`)}</button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= Calendar: the birthdays ================= */

/** Staff birthdays (HrPanel's People zone until v1.192.0): maintained in the
    staff directory, sorted by month and day. Not cached on the device. */
function Birthdays() {
  const [birthdays, setBirthdays] = useState<{ name: string; birthday: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ birthdays: { name: string; birthday: string }[] }>(`/staff/birthdays`).then((b) => {
      if (!live) return;
      if (b.data) setBirthdays(b.data.birthdays ?? []);
      setLoaded(true);
    });
    return () => { live = false; };
  }, []);
  const md = mytToday().slice(5);
  /* the year turns at today: whoever is still to come this year, first */
  const ordered = [...birthdays.filter((b) => b.birthday.slice(5) >= md), ...birthdays.filter((b) => b.birthday.slice(5) < md)];
  return (
    <section className={card} aria-label={L("Staff birthdays", "Hari lahir kakitangan")}>
      <div className={css.head}>
        <div className={css.lead}>
          <span className={`${css.well} ${css.gold}`}><AppIcon name="cake" /></span>
          <div className={css.headText}>
            <p className={css.title}>{L("Staff birthdays", "Hari lahir kakitangan")}</p>
            <p className={css.sub}>{L("Maintained in the staff directory (birthday field). The next one first.", "Diselenggara dalam direktori kakitangan (medan hari lahir). Yang terdekat dahulu.")}</p>
          </div>
        </div>
      </div>
      <ul className={css.rows}>
        {!loaded && Array.from({ length: 4 }, (_, i) => <li key={`skel-${i}`} className={css.row} aria-hidden><Skel className={css.skelLine} /></li>)}
        {loaded && birthdays.length === 0 && (
          <li className={css.empty}>{L("No birthdays recorded yet — add them via the staff directory.", "Tiada hari lahir direkodkan lagi — tambah melalui direktori kakitangan.")}</li>
        )}
        {ordered.map((b) => (
          <li key={b.name} className={css.row}>
            <span className={css.rowName}>{b.name}</span>
            <span className={b.birthday.slice(5) === md ? chipSmSuccess : css.muted}>{b.birthday.slice(5) === md ? L("Today", "Hari ini") : dmy(b.birthday)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ================= HR Administration ================= */

function LinkCard({ icon, title, text, action, onClick }: { icon: AppIconName; title: string; text: string; action: string; onClick: () => void }) {
  return (
    <section className={`${card} ${css.linkCard}`}>
      <span className={`${css.well} ${css.navy}`}><AppIcon name={icon} /></span>
      <span className={css.headText}>
        <span className={css.title}>{title}</span>
        <span className={css.sub}>{text}</span>
      </span>
      <button type="button" className={btnSm} onClick={onClick}>{action} <AppIcon name="next" /></button>
    </section>
  );
}

/* the gates below mirror worker/src/permissions.ts; they decide what is
   SHOWN, the worker decides what is allowed */
const CAN = {
  task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"],
  hr_manage: HR_ADMIN_ROLES,
  events_manage: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"],
  leave_entitlement: ["super_admin", "ceo"],
};

function HrAdministration({ role, admin, go, canOpen, open }: {
  role: string;
  admin: boolean;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
  open: (v: HrView, sub?: PeopleTab) => void;
}) {
  type Ctl = { icon: AppIconName; title: string; where: string; text: string; show: boolean; onClick: () => void };
  const controls: Ctl[] = [
    { icon: "holiday", title: L("Public holidays", "Cuti umum"), where: L("HR · Calendar & Holidays", "HR · Kalendar & Cuti"),
      text: L("Add or remove holidays; a weekend public holiday gets its Monday replacement.", "Tambah atau buang cuti; cuti umum hujung minggu mendapat gantian Isnin."),
      show: admin, onClick: () => open("calendar") },
    { icon: "date", title: L("Company events", "Acara syarikat"), where: L("HR · Calendar & Holidays", "HR · Kalendar & Cuti"),
      text: L("Trainings, classes, meetings - who must attend is notified.", "Latihan, kelas, mesyuarat - yang perlu hadir dimaklumkan."),
      show: holds("events_manage", CAN.events_manage.includes(role)), onClick: () => open("calendar") },
    { icon: "offboard", title: L("Joining, leaving, probation, letters", "Masuk, keluar, percubaan, surat"), where: L("HR · Employee Lifecycle", "HR · Kitaran Pekerja"),
      text: L("Checklists, probation decisions, numbered letters, training records.", "Senarai semak, keputusan percubaan, surat bernombor, rekod latihan."),
      show: admin, onClick: () => open("lifecycle") },
    { icon: "identification", title: L("Employee records", "Rekod pekerja"), where: L("Staff Details", "Butiran Kakitangan"),
      text: L("Profiles, employment status, documents, the joining checklist.", "Profil, status pekerjaan, dokumen, senarai semak kemasukan."),
      show: canOpen("Staff Details"), onClick: () => go("Staff Details") },
    { icon: "holiday", title: L("Leave approvals", "Kelulusan cuti"), where: L("Leave", "Cuti"),
      text: L("Every application through its approval chain.", "Setiap permohonan melalui rantaian kelulusannya."),
      show: canOpen("Leave"), onClick: () => go("Leave") },
    { icon: "balance", title: L("Leave entitlements", "Kelayakan cuti"), where: L("Leave", "Cuti"),
      text: L("Annual leave per person - the CEO's control.", "Cuti tahunan setiap orang - kawalan CEO."),
      show: canOpen("Leave") && holds("leave_entitlement", CAN.leave_entitlement.includes(role)), onClick: () => go("Leave") },
    { icon: "receipt", title: L("Claims decisions", "Keputusan tuntutan"), where: L("Claims", "Tuntutan"),
      text: L("Approve, reject and pay staff claims.", "Lulus, tolak dan bayar tuntutan kakitangan."),
      show: canOpen("Claims"), onClick: () => go("Claims") },
    { icon: "time", title: L("Working hours, OT rules, corrections", "Waktu kerja, peraturan OT, pembetulan"), where: L("Attendance · Settings", "Kehadiran · Tetapan"),
      text: L("Manual entries, unpaid leave, the attendance export.", "Catatan manual, cuti tanpa gaji, eksport kehadiran."),
      show: canOpen("Attendance"), onClick: () => go("Attendance") },
    { icon: "money", title: L("Payroll runs", "Larian gaji"), where: L("Payroll", "Gaji"),
      text: L("Salaries, statutory deductions, payslips and exports.", "Gaji, potongan berkanun, slip gaji dan eksport."),
      show: canOpen("Payroll"), onClick: () => go("Payroll") },
    { icon: "access", title: L("Roles & tab access", "Peranan & akses tab"), where: L("Users", "Pengguna"),
      text: L("Who can open HR and every other module.", "Siapa boleh membuka HR dan setiap modul lain."),
      show: canOpen("Users"), onClick: () => go("Users") },
  ];
  const shown = controls.filter((c) => c.show);
  const access: [string, boolean][] = [
    [L("Submit and read task reports", "Hantar dan baca laporan tugasan"), holds("task_reports", CAN.task_reports.includes(role))],
    [L("Add and remove public holidays", "Tambah dan buang cuti umum"), holds("hr_manage", CAN.hr_manage.includes(role))],
    [L("Create and edit company events", "Cipta dan sunting acara syarikat"), holds("events_manage", CAN.events_manage.includes(role))],
    [L("Joining, leaving, probation, letters and training", "Masuk, keluar, percubaan, surat dan latihan"), holds("hr_manage", CAN.hr_manage.includes(role))],
    [L("Generate payslip summaries here", "Jana ringkasan slip gaji di sini"), admin],
    [L("Set leave entitlements", "Tetapkan kelayakan cuti"), holds("leave_entitlement", CAN.leave_entitlement.includes(role))],
  ];
  return (
    <>
      <TabZone label={L("HR controls", "Kawalan HR")} hint={L("Every HR setting the portal already has, and where it lives. Nothing here is a new control.", "Setiap tetapan HR yang sedia ada dalam portal, dan di mana ia berada. Tiada kawalan baharu di sini.")}>
        <div className={css.controls}>
          {shown.map((c) => (
            <button key={c.title} type="button" className={css.control} onClick={c.onClick}>
              <span className={`${css.qaIcon} ${css.navy}`}><AppIcon name={c.icon} /></span>
              <span className={css.headText}>
                <span className={css.controlTitle}>{c.title}</span>
                <span className={css.sub}>{c.text}</span>
                <span className={css.where}>{c.where} →</span>
              </span>
            </button>
          ))}
        </div>
      </TabZone>
      <TabZone label={L("Your HR access", "Akses HR anda")} hint={L("What this account may do in HR. Access is changed in Users → Roles & Permissions.", "Apa yang akaun ini boleh buat dalam HR. Akses ditukar di Pengguna → Peranan & Kebenaran.")}>
        <section className={card}>
          <ul className={css.rows}>
            {access.map(([what, yes]) => (
              <li key={what} className={css.row}>
                <span className={css.rowName}><AppIcon name={yes ? "success" : "lock"} className={yes ? css.ok : css.muted} /> {what}</span>
                <span className={yes ? chipSmSuccess : chipSmNeutral}>{yes ? L("Allowed", "Dibenarkan") : L("Not for this role", "Bukan untuk peranan ini")}</span>
              </li>
            ))}
          </ul>
        </section>
      </TabZone>
    </>
  );
}
