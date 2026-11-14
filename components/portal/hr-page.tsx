"use client";

/* v1.306.0 - HR WORKSPACE 4.0 (the CEO, 14-11-2026: "STRICT CEO DIRECTIVE -
   REMOVE DUPLICATION"; "proceed as per recommend" on
   claude/HR-WORKSPACE-4.0-BLUEPRINT.md, H-0 ... H-10). HR holds only what
   Human Resources owns, in four tabs, the view in the address
   (/portal?tab=HR&view=...), the Dashboard's view switch on a phone:

     Overview               three figures, the HR lifecycle worklist, the
                            upcoming people milestones (hr-overview.tsx)
     Employee Lifecycle     Joining · Probation · Letters · Training · Leaving
                            (PeoplePanel, hr_manage); the joining checklist's
                            one editor (H-3)
     Calendar & Holidays    the ONE company calendar (UpcomingEventsCard - the
                            same events, holidays and birthdays the Dashboard
                            shows), the holiday controls as they really are,
                            and the holiday list (HolidaysCard, hr_manage)
     HR Policies & Settings the HR policy library as it exists (read-only -
                            nothing versioned is invented, H-5), the links to
                            the modules that own the rest, and the HR audit
                            history (GET /staff/people/history, hr_manage, H-9)

   WHAT LEFT, AND WHERE IT LIVES: the written task reports -> Tasks > Reports
   & Archive (task-reports.tsx, moved, H-1; ?view=reports is sent there); the
   payslip summary -> Payroll, which already has the figures (H-2); the HR
   Administration launcher and "Your HR access" -> the four module links and
   Users & Security. No route, table or permission changed; the server
   decides every action as before. */

import { holds } from "@/lib/caps";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { HolidaysCard } from "@/components/admin/hr-admin-panel";
import { UpcomingEventsCard } from "@/components/portal/events";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { HrOverview, type HrView } from "@/components/portal/hr-overview";
import { L, type User } from "@/components/portal/page-shared";
import { JOINING_LABEL, LEAVING_LABEL, PeoplePanel, type PeopleTab } from "@/components/portal/people-panel";
import { usePortal } from "@/components/portal/portal-provider";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { AppIcon } from "@/components/ui/app-icon";
import { LineTabs } from "@/components/ui/line-tabs";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmyMYT, mytToday } from "@/lib/format";
import { LETTER_LABEL, type LetterKind } from "@/lib/hr-letters";
import type { TabName } from "@/lib/portal-tabs";
import { useTabViewAddress } from "@/lib/tab-view";
import { btnSm, card, chipSmInfo, chipSmNeutral, chipSmSuccess } from "@/lib/ui-styles";
import css from "./hr-page.module.css";

/* the roles that keep the HR records - the same four as hr_manage in
   worker/src/permissions.ts (unchanged) */
export const HR_ADMIN_ROLES = ["hr_admin", "ceo", "super_admin", "admin"];
const VIEWS: readonly HrView[] = ["overview", "lifecycle", "calendar", "policies"];
const isView = (v: string | null): v is HrView => !!v && (VIEWS as readonly string[]).includes(v);

export function HrPage({ user, go, canOpen, startView }: {
  user: User;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
  startView?: string;
}) {
  const admin = holds("hr_manage", HR_ADMIN_ROLES.includes(user.role));
  const { openRecord, setTabStart } = usePortal();
  const [view, setView] = useState<HrView>(() => (isView(startView ?? null) ? startView as HrView : "overview"));
  const [seen, setSeen] = useState<readonly HrView[]>(() => [isView(startView ?? null) ? startView as HrView : "overview"]);
  const [people, setPeople] = useState<PeopleTab>("joining");
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if (isView(startView ?? null)) { setView(startView as HrView); setSeen((s) => (s.includes(startView as HrView) ? s : [...s, startView as HrView])); } }
  useTabViewAddress("HR", view, setView, isView);

  /* the old HR Reports address (and the old "Submit report") now lives in Tasks (H-1) */
  useEffect(() => {
    if (startView === "reports") { setTabStart({ tab: "Tasks", view: "reports" }); go("Tasks"); }
  }, [startView, setTabStart, go]);

  const open = useCallback((v: HrView, sub?: PeopleTab) => {
    setView(v);
    setSeen((s) => (s.includes(v) ? s : [...s, v]));
    if (sub) setPeople(sub);
  }, []);
  const has = (v: HrView) => seen.includes(v) || view === v;
  const TABS: readonly (readonly [HrView, string, string])[] = [
    ["overview", L("Overview", "Gambaran"), L("Figures, worklist and milestones", "Angka, senarai kerja dan peristiwa")],
    ["lifecycle", L("Employee Lifecycle", "Kitaran Pekerja"), L("Joining, probation, letters, training, leaving", "Masuk, percubaan, surat, latihan, keluar")],
    ["calendar", L("Calendar & Holidays", "Kalendar & Cuti Umum"), L("Holidays and company events", "Cuti umum dan acara syarikat")],
    ["policies", L("HR Policies & Settings", "Dasar & Tetapan HR"), L("Templates, module links, audit history", "Templat, pautan modul, sejarah audit")],
  ];

  return (
    <TabPage className={css.page}>
      <div className="erp-desktop-only">
        <LineTabs value={view} onChange={(k) => open(k)} tabs={TABS.map(([k, l]) => [k, l] as const)} label={L("HR", "HR")} />
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="hr-view-bar">
        <ViewSwitch value={view} onChange={(k) => open(k)} label={L("HR view", "Paparan HR")} options={TABS} />
      </div>

      <div hidden={view !== "overview"} className={css.body}>
        <HrOverview admin={admin} go={go} canOpen={canOpen} open={open} />
      </div>

      {has("lifecycle") && (
        <div hidden={view !== "lifecycle"} className={css.body} data-testid="hr-lifecycle">
          <Intro eyebrow={L("Joining · probation · letters · training · leaving", "Masuk · percubaan · surat · latihan · keluar")} title={L("Employee Lifecycle", "Kitaran Pekerja")}
            sub={L("HR-owned steps around the Staff record. The person's profile, status and uploaded documents stay in Staff.", "Langkah milik HR di sekitar rekod Kakitangan. Profil, status dan dokumen yang dimuat naik kekal dalam Kakitangan.")}
            action={canOpen("Staff Details") ? <button type="button" className={btnSm} onClick={() => go("Staff Details")}>{L("Open Staff Directory", "Buka Direktori Kakitangan")} <AppIcon name="next" /></button> : null} />
          {admin
            ? <PeoplePanel tab={people} onTab={setPeople} openRecord={canOpen("Staff Details") ? (id) => openRecord("Staff Details", "staff", id) : undefined} />
            : <PermissionPlaceholder title={L("Employee lifecycle", "Kitaran pekerja")} />}
        </div>
      )}

      {has("calendar") && (
        <div hidden={view !== "calendar"} className={css.body} data-testid="hr-calendar">
          <Intro eyebrow={L("Holiday applicability · company events", "Kebolehgunaan cuti · acara syarikat")} title={L("Calendar & Holidays", "Kalendar & Cuti Umum")}
            sub={L("One shared calendar. HR manages the holidays and people events; Leave, Attendance and Payroll read the same dates.", "Satu kalendar dikongsi. HR mengurus cuti dan acara kakitangan; Cuti, Kehadiran dan Gaji membaca tarikh yang sama.")} />
          <div className={css.split}>
            <UpcomingEventsCard role={user.role} />
            <HolidayControls />
          </div>
          <TabZone label={L("Public & replacement holidays", "Cuti umum & gantian")}>
            {admin ? <HolidaysCard /> : <PermissionPlaceholder title={L("Public holidays", "Cuti umum")} />}
          </TabZone>
        </div>
      )}

      {has("policies") && (
        <div hidden={view !== "policies"} className={css.body} data-testid="hr-policies">
          <HrPolicies admin={admin} go={go} canOpen={canOpen} open={open} />
        </div>
      )}
    </TabPage>
  );
}

function Intro({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className={css.intro}>
      <div className={css.headText}>
        <p className={css.eyebrow}>{eyebrow}</p>
        <p className={css.pageTitle}>{title}</p>
        <p className={css.sub}>{sub}</p>
      </div>
      {action}
    </div>
  );
}

/* ================= Calendar: the holiday controls, as they really are ================= */

type Holiday = { id: number; holiday_date: string; name: string; kind: string };
/** H-8: one company calendar (Johor) - per-state applicability is not built.
    The sources and the replacement rule are read from the existing rows and
    the existing rule; nothing here changes either. */
function HolidayControls() {
  const year = mytToday().slice(0, 4);
  const [rows, setRows] = useState<Holiday[] | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ holidays: Holiday[] }>(`/staff/holidays?year=${year}`).then((r) => { if (live) setRows(r.ok && r.data ? r.data.holidays : []); });
    return () => { live = false; };
  }, [year]);
  const n = (k: string) => (rows ?? []).filter((h) => h.kind === k).length;
  return (
    <section className={card} aria-label={L("Holiday controls", "Kawalan cuti")} data-testid="hr-holiday-controls">
      <div className={css.headText}>
        <p className={css.title}>{L("Holiday controls", "Kawalan cuti")}</p>
        <p className={css.sub}>{L("How the company calendar is set today.", "Cara kalendar syarikat ditetapkan hari ini.")}</p>
      </div>
      {rows === null ? <SkelRows rows={3} /> : (
      <ul className={css.work}>
        <li>
          <span className={css.workText}><strong>{L("Applicable state / workplace", "Negeri / tempat kerja")}</strong>
            <span className={css.sub}>{L("Johor — one calendar for every staff member.", "Johor — satu kalendar untuk setiap kakitangan.")}</span></span>
          <span className={chipSmNeutral}>{L("One calendar", "Satu kalendar")}</span>
        </li>
        <li>
          <span className={css.workText}><strong>{L("Public holiday sources", "Sumber cuti umum")}</strong>
            <span className={css.sub}>{L(`${year}: ${n("public")} public, ${n("company")} company and ${n("replacement")} replacement days. The 2026 Johor dates were loaded from the state gazette (circular of 10 Dec 2025); every later addition is in the HR audit history.`, `${year}: ${n("public")} cuti umum, ${n("company")} cuti syarikat dan ${n("replacement")} hari gantian. Tarikh Johor 2026 dimuat daripada warta negeri (pekeliling 10 Dis 2025); setiap tambahan kemudian ada dalam sejarah audit HR.`)}</span></span>
        </li>
        <li>
          <span className={css.workText}><strong>{L("Replacement day policy", "Dasar hari gantian")}</strong>
            <span className={css.sub}>{L("A public holiday on a Saturday or Sunday is replaced on the Monday, or the next free working day (company policy). A replacement row can be removed to follow the gazette instead.", "Cuti umum pada Sabtu atau Ahad diganti pada Isnin, atau hari bekerja kosong seterusnya (dasar syarikat). Baris gantian boleh dibuang untuk mengikut warta.")}</span></span>
          <span className={chipSmInfo}>{L("Company rule", "Peraturan syarikat")}</span>
        </li>
      </ul>
      )}
      <p className={css.boundary}>{L("Approved holiday dates feed Leave and Attendance through one calendar source. Event entries are not duplicated in Tasks or the Dashboard.", "Tarikh cuti yang diluluskan disalurkan ke Cuti dan Kehadiran melalui satu sumber kalendar. Acara tidak diduplikasi dalam Tugasan atau Papan Pemuka.")}</p>
    </section>
  );
}

/* ================= HR Policies & Settings ================= */

type HistRow = { id: number; action: string; entity_id: string | null; created_at: string; user_name: string | null };
const ACTION_WORD: Record<string, [string, string]> = {
  "staff.onboarding": ["Joining checklist updated", "Senarai semak kemasukan dikemas kini"], "staff.leaving_checklist": ["Leaving checklist updated", "Senarai semak keluar dikemas kini"],
  "staff.probation_set": ["Probation end date set", "Tarikh tamat percubaan ditetapkan"], "staff.probation_decide": ["Probation decided", "Percubaan diputuskan"],
  "staff.letter_issue": ["Letter issued", "Surat dikeluarkan"], "staff.letter_void": ["Letter voided", "Surat dibatalkan"],
  "staff.training_add": ["Training recorded", "Latihan direkod"], "staff.training_remove": ["Training removed", "Latihan dibuang"],
  "holiday.create": ["Holiday added", "Cuti ditambah"], "holiday.delete": ["Holiday removed", "Cuti dibuang"],
  "event.create": ["Event created", "Acara dicipta"], "event.update": ["Event changed", "Acara diubah"], "event.delete": ["Event removed", "Acara dibuang"],
};

function HrPolicies({ admin, go, canOpen, open }: { admin: boolean; go: (t: TabName) => void; canOpen: (t: string) => boolean; open: (v: HrView, sub?: PeopleTab) => void }) {
  const [hist, setHist] = useState<{ state: "idle" | "loading" | "ok" | "error"; rows: HistRow[] }>({ state: "idle", rows: [] });
  const loadHist = async () => {
    setHist({ state: "loading", rows: [] });
    const r = await api<{ entries: HistRow[] }>("/staff/people/history");
    setHist(r.ok && r.data ? { state: "ok", rows: r.data.entries } : { state: "error", rows: [] });
  };
  const letters = (Object.keys(LETTER_LABEL) as LetterKind[]).map((k) => L(LETTER_LABEL[k][0], LETTER_LABEL[k][1]).toLowerCase());
  const library: [string, string, PeopleTab][] = [
    [L("Employment letter templates", "Templat surat pekerjaan"), letters.join(", "), "letters"],
    [L("Joining & leaving checklists", "Senarai semak masuk & keluar"), L(`${Object.keys(JOINING_LABEL).length} joining and ${Object.keys(LEAVING_LABEL).length} leaving steps, with links to Staff and Assets`, `${Object.keys(JOINING_LABEL).length} langkah masuk dan ${Object.keys(LEAVING_LABEL).length} langkah keluar, dengan pautan ke Kakitangan dan Aset`), "joining"],
    [L("Probation & review standards", "Standard percubaan & semakan"), L("End date per person, a Desk reminder 14 days ahead, then confirmed, extended or ended", "Tarikh tamat setiap orang, peringatan Meja 14 hari lebih awal, kemudian disahkan, dilanjutkan atau ditamatkan"), "probation"],
    [L("Training and certification", "Latihan dan pensijilan"), L("Course, provider, date, hours, cost and who paid — per person", "Kursus, penyedia, tarikh, jam, kos dan siapa membayar — setiap orang"), "training"],
  ];
  const links: [string, string, string, TabName][] = [
    [L("Leave entitlements & approvals", "Kelayakan & kelulusan cuti"), L("Managed in Leave.", "Diurus dalam Cuti."), L("Open Leave", "Buka Cuti"), "Leave"],
    [L("Payroll runs & payslips", "Larian gaji & slip gaji"), L("Managed only in Payroll.", "Diurus hanya dalam Gaji."), L("Open Payroll", "Buka Gaji"), "Payroll"],
    [L("Attendance & OT rules", "Kehadiran & peraturan OT"), L("Managed only in Attendance.", "Diurus hanya dalam Kehadiran."), L("Open Attendance", "Buka Kehadiran"), "Attendance"],
    [L("User roles and access", "Peranan & akses pengguna"), L("Managed only in Users & Security.", "Diurus hanya dalam Pengguna & Keselamatan."), L("Open Users", "Buka Pengguna"), "Users"],
  ];
  return (
    <>
      <Intro eyebrow={L("HR-specific governance", "Tadbir urus khusus HR")} title={L("HR Policies & Settings", "Dasar & Tetapan HR")}
        sub={L("The templates and standards HR works from — not a launcher for every People module.", "Templat dan standard yang digunakan HR — bukan pelancar untuk setiap modul Kakitangan.")}
        action={admin ? <button type="button" className={btnSm} onClick={() => void loadHist()} data-testid="hr-audit-open">{L("View audit history", "Lihat sejarah audit")} <AppIcon name="next" /></button> : null} />
      <div className={css.split}>
        <section className={card} aria-label={L("HR policy library", "Pustaka dasar HR")} data-testid="hr-library">
          <div className={css.headText}>
            <p className={css.title}>{L("HR policy library", "Pustaka dasar HR")}</p>
            <p className={css.sub}>{L("What HR issues from today. Built into the portal — not versioned; a change is a new release.", "Apa yang digunakan HR hari ini. Terbina dalam portal — tidak berversi; perubahan ialah keluaran baharu.")}</p>
          </div>
          <ul className={css.work}>
            {library.map(([t, sub, seg]) => (
              <li key={t}>
                <span className={css.workText}><strong>{t}</strong><span className={css.sub}>{sub}</span></span>
                <span className={chipSmNeutral}>{L("Built-in", "Terbina")}</span>
                {admin && <button type="button" className={btnSm} onClick={() => open("lifecycle", seg)}>{L("Open", "Buka")} <AppIcon name="next" /></button>}
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label={L("Authoritative module links", "Pautan modul berautoriti")} data-testid="hr-module-links">
          <div className={css.headText}>
            <p className={css.title}>{L("Authoritative module links", "Pautan modul berautoriti")}</p>
            <p className={css.sub}>{L("Their controls, balances and permissions are not repeated here.", "Kawalan, baki dan kebenaran mereka tidak diulang di sini.")}</p>
          </div>
          <ul className={css.work}>
            {links.filter(([, , , t]) => canOpen(t)).map(([t, sub, act, tab]) => (
              <li key={tab}>
                <span className={css.workText}><strong>{t}</strong><span className={css.sub}>{sub}</span></span>
                <button type="button" className={btnSm} onClick={() => go(tab)}>{act} <AppIcon name="next" /></button>
              </li>
            ))}
          </ul>
          <p className={css.boundary}>{L("This page holds HR-owned settings only.", "Halaman ini hanya memegang tetapan milik HR.")}</p>
        </section>
      </div>
      {hist.state !== "idle" && (
        <section className={card} aria-label={L("HR audit history", "Sejarah audit HR")} data-testid="hr-audit">
          <div className={css.headText}>
            <p className={css.title}>{L("HR audit history", "Sejarah audit HR")}</p>
            <p className={css.sub}>{L("Checklists, probation, letters, training, holidays and company events — the latest 300, newest first. Never the rest of the system log.", "Senarai semak, percubaan, surat, latihan, cuti dan acara syarikat — 300 terkini, terbaru dahulu. Bukan log sistem yang lain.")}</p>
          </div>
          {hist.state === "loading" ? <SkelRows rows={4} />
            : hist.state === "error" ? <p className={css.empty}>{L("The HR audit history could not be read just now.", "Sejarah audit HR tidak dapat dibaca sekarang.")}</p>
            : hist.rows.length === 0 ? <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p>
            : (
              <ul className={css.work}>
                {hist.rows.map((r) => (
                  <li key={r.id}>
                    <span className={css.workText}><strong>{ACTION_WORD[r.action] ? L(ACTION_WORD[r.action]![0], ACTION_WORD[r.action]![1]) : r.action}</strong>
                      <span className={css.sub}>{dmyMYT(r.created_at)} · {r.user_name ?? "—"}</span></span>
                    <span className={r.action.endsWith("delete") || r.action.endsWith("void") || r.action.endsWith("remove") ? chipSmNeutral : chipSmSuccess}>{r.action.split(".")[0] === "staff" ? "HR" : r.action.split(".")[0] === "holiday" ? L("Holiday", "Cuti") : L("Event", "Acara")}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </>
  );
}
