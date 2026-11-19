"use client";

/* v1.307.0 - ATTENDANCE RECORDS, ATTENDANCE WORKSPACE 4.0 (reference image 2).
   The day register: one row a person for the chosen day, from THE verdict
   (GET /staff/attendance/day), with the reference's filters - date, team,
   staff, search - and its status legend; a table on a wide screen, cards on
   a phone. View opens the person's day in a drawer:

     Attendance Details  scheduled shift, clock in, clock out, hours, status,
                         and where each punch was made - a word and a
                         distance (A-8: raw coordinates only for the CEO; no
                         photo is taken at a punch, so none is shown)
     Punch History       every punch that day, marked real / manual /
                         amended / waiting for approval
     Corrections         that day's forgotten punches (decided in Exceptions &
                         Approvals) and, from 19-11-2026, the corrections
                         themselves for attendance_correct: change a punch's
                         time, remove one, add a missing one - with a reason
     Audit Log           the person's attendance and overtime events
                         (GET /staff/attendance/audit - read only)

   Export: this day as CSV, and the month's punches for Payroll (the
   existing /attendance/export, payroll_export). Only the Corrections tab writes (attendance-correct.tsx). */

import { useEffect, useState, type ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { FilterField, FilterPopover } from "@/components/ui/filter-popover";
import { PaginationControls, type PageSize } from "@/components/ui/pagination-controls";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { downloadCsv } from "@/lib/csv";
import { dmyMYT, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { TodayRows } from "./attendance-overview";
import { STATUS, StatusChip, addDays, dayLabel, hhmm, hm, leaveWord, locText, mytHm, type DayRegister, type DayStatus, type PersonDay } from "./attendance-shared";
import { DayCorrections } from "./attendance-correct"; // 19-11-2026 - correct the day inside its own drawer
import { usePortal } from "./portal-provider";
import { holds } from "@/lib/caps";
import css from "./attendance4.module.css";

/* the six figures of the day (the reference's KPI strip) - each is the filter it names.
   Day statuses for ONE day, from THE verdict; never a month's punch count. */
const LEGEND: [string, string, DayStatus[], AppIconName, KpiTone][] = [
  ["Present", "Hadir", ["present", "on_shift"], "users", "green"], ["Late", "Lewat", ["late"], "time", "gold"],
  ["Missing clock-in", "Tiada daftar masuk", ["not_in", "absent", "pending"], "warning", "red"],
  ["Missing clock-out", "Tiada daftar keluar", ["missing_out"], "alert", "red"], ["On leave", "Bercuti", ["leave"], "date", "blue"],
  ["Off day", "Hari cuti", ["rest_day", "holiday"], "holiday", "navy"],
];

/* 18-11-2026 - TEAM ATTENDANCE REPORT (the CEO's approved reference): one card - the title, ONE
   connected KPI strip, one toolbar (day, team, staff, search, Export), the register 10 a page with
   page-size control, and View for a person's day. The same request (/staff/attendance/day), the
   same filters, the same CSV and the same payroll export as the day register it replaces; the
   month's punch log moved behind "Month punch log" (a drawer) instead of a long table under it. */
export function AttendanceRecords({ canExport, openPerson, day, setDay, monthLog }: { canExport: boolean; openPerson: (id: number, day: string) => void; day: string; setDay: (d: string) => void; monthLog?: ReactNode }) {
  const reg = useCachedApi<DayRegister>(`/staff/attendance/day?date=${day}`, true, ["attendance"]);
  const staff = reg.data?.staff ?? [];
  const [team, setTeam] = useState("");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [leg, setLeg] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [menu, setMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const teams = [...new Set(staff.map((p) => p.department || p.position || "").filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const rows = staff.filter((p) => (!team || (p.department || p.position) === team) && (!who || String(p.id) === who)
    && (!needle || `${p.name} ${p.position ?? ""}`.toLowerCase().includes(needle)) && (leg === null || LEGEND[leg]![2].includes(p.verdict.status)));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * size, cur * size);
  const today = mytToday();
  /* Escape or a press elsewhere closes the export menu */
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element | null)?.closest?.("[data-export-menu]")) setMenu(false); };
    document.addEventListener("keydown", close); document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
  }, [menu]);
  const exportDay = () => downloadCsv(`attendance-${day}.csv`, [
    ["Date", "Staff", "Position", "Department", "Scheduled shift", "Clock in", "Clock out", "Hours", "Status", "Late (min)"],
    ...rows.map((p) => [day, p.name, p.position ?? "", p.department ?? "", p.shift_label ?? "", mytHm(p.first_in), mytHm(p.last_out), (p.worked_minutes / 60).toFixed(2), p.verdict.status === "leave" ? leaveWord(p.leave_type) : STATUS[p.verdict.status][0], p.verdict.lateMinutes || ""]),
  ]);
  const reset = () => setPage(1);
  const teamSel = (
    <select className={selectClassSm} value={team} onChange={(e) => { setTeam(e.target.value); reset(); }} aria-label={L("Team / Department", "Pasukan / Jabatan")}>
      <option value="">{L("All teams", "Semua pasukan")}</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
  const whoSel = (
    <select className={selectClassSm} value={who} onChange={(e) => { setWho(e.target.value); reset(); }} aria-label={L("Staff", "Kakitangan")}>
      <option value="">{L("All staff", "Semua kakitangan")}</option>{staff.map((p) => <option key={p.id} value={p.id}>{properName(p.name)}</option>)}
    </select>
  );
  return (
    <section className={card} aria-label={L("Team attendance report", "Laporan kehadiran pasukan")} data-testid="att-records">
      <div className={css.headText}>
        <p className={`${css.title} ${css.repTitle}`}>{L("Team Attendance Report", "Laporan Kehadiran Pasukan")}</p>
        <p className={css.sub}>{L("Summary of team attendance for the selected day. View details to see full punch history and verification.", "Ringkasan kehadiran pasukan bagi hari dipilih. Lihat butiran untuk sejarah ketukan penuh dan pengesahan.")}</p>
      </div>
      <div className={css.repStrip}>
        <KpiRow label={L("The day's attendance", "Kehadiran hari ini")} testid="att-figures">
          {LEGEND.map(([en, ms, ks, icon, tone], i) => (
            <KpiTile key={en} icon={icon} tone={tone} label={L(en, ms)} value={staff.filter((p) => ks.includes(p.verdict.status)).length} busy={reg.loading && !reg.data}
              onClick={() => { setLeg(leg === i ? null : i); reset(); }} pressed={leg === i} cell={`att-${i}`} testid="att-legend" />
          ))}
        </KpiRow>
      </div>
      <div className={css.repBar}>
        <span className={css.repDay}>
          <button type="button" className={btnSm} onClick={() => { setDay(addDays(day, -1)); reset(); }} aria-label={L("Previous day", "Hari sebelum")}><AppIcon name="previous" /></button>
          <input type="date" className={inputClassSm} value={day} max={today} onChange={(e) => { if (e.target.value) { setDay(e.target.value); reset(); } }} aria-label={L("Date", "Tarikh")} data-testid="att-date" />
          <button type="button" className={btnSm} disabled={day >= today} onClick={() => { setDay(addDays(day, 1)); reset(); }} aria-label={L("Next day", "Hari seterusnya")}><AppIcon name="next" /></button>
        </span>
        <span className={`erp-desktop-only ${css.repSel}`}>{teamSel}</span>
        <span className={`erp-desktop-only ${css.repSelWide}`}>{whoSel}</span>
        <label className={css.repSearch}>
          <AppIcon name="search" />
          <input type="search" className={inputClassSm} value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder={L("Search staff or position…", "Cari kakitangan atau jawatan…")} aria-label={L("Search", "Cari")} />
        </label>
        {/* a phone keeps the team and staff picks behind one Filters button (the shared panel) */}
        <span className={`erp-phone-only ${css.repFilters}`}>
          <FilterPopover count={(team ? 1 : 0) + (who ? 1 : 0)} onClear={() => { setTeam(""); setWho(""); reset(); }} testid="att-filters">
            <FilterField label={L("Team", "Pasukan")}>{teamSel}</FilterField>
            <FilterField label={L("Staff", "Kakitangan")}>{whoSel}</FilterField>
          </FilterPopover>
        </span>
        <span className={css.repRule} aria-hidden="true" />
        <span className={css.repExport} data-export-menu="">
          {canExport ? (
            <>
              <button type="button" className={btnSm} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)} data-testid="att-export"><AppIcon name="download" />{L("Export (CSV)", "Eksport (CSV)")}</button>
              {menu && (
                <div className={`erp-menu ${css.repMenu}`} role="menu">
                  <button type="button" role="menuitem" onClick={() => { exportDay(); setMenu(false); }} data-testid="att-export-day">{L("This day (CSV)", "Hari ini (CSV)")}</button>
                  <a role="menuitem" href={`/api/v1/staff/attendance/export?month=${day.slice(0, 7)}`} onClick={() => setMenu(false)}>{L("Month for Payroll", "Bulan untuk Gaji")}</a>
                </div>
              )}
            </>
          ) : (
            <button type="button" className={btnSm} onClick={exportDay} data-testid="att-export-day"><AppIcon name="download" />{L("Export (CSV)", "Eksport (CSV)")}</button>
          )}
        </span>
      </div>
      {reg.loading && !reg.data ? <SkelRows rows={6} /> : <TodayRows rows={shown} offset={(cur - 1) * size} compact shiftHead={L("Shift", "Syif")} openPerson={(id) => openPerson(id, day)} />}
      <div className={css.repFoot}>
        <p className={css.repInfo}>
          <AppIcon name="info" />
          <span>{L("Click View to see detailed punch history, verification and location logs for the staff.", "Klik Lihat untuk sejarah ketukan, pengesahan dan log lokasi kakitangan.")}
            {" "}{dayLabel(day)}{reg.data ? L(` · late after start + ${reg.data.grace_minutes} min`, ` · lewat selepas mula + ${reg.data.grace_minutes} min`) : ""}</span>
          {monthLog && <button type="button" className={css.repLink} onClick={() => setLogOpen(true)} data-testid="att-month-log">{L("Month punch log", "Log ketukan bulanan")}</button>}
        </p>
        <PaginationControls page={cur} total={rows.length} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} label={L("Team attendance report pages", "Halaman laporan kehadiran pasukan")} testid="att-pages" />
      </div>
      {monthLog && (
        <SideDrawer open={logOpen} onClose={() => setLogOpen(false)} wide title={L("Month punch log", "Log ketukan bulanan")} subtitle={L("Every punch across the team for the month - sort a column, or find one person.", "Setiap ketukan seluruh pasukan untuk bulan ini - susun lajur, atau cari seorang.")}>
          {logOpen ? monthLog : null}
        </SideDrawer>
      )}
    </section>
  );
}

type Tab = "details" | "punches" | "corrections" | "audit";
type AuditRow = { id: number; action: string; detail: string | null; created_at: string; user_name: string | null };
const ACTION: Record<string, [string, string]> = {
  "attendance.manual": ["Manual record added", "Rekod manual ditambah"], "attendance.amend": ["Punch amended", "Ketukan dipinda"], "attendance.delete": ["Record removed", "Rekod dibuang"],
  "attendance.forgot_approve": ["Forgotten punch approved", "Ketukan terlupa diluluskan"], "attendance.forgot_reject": ["Forgotten punch rejected", "Ketukan terlupa ditolak"],
  "ot.decide": ["Overtime decided", "OT diputuskan"], "ot.replacement_leave": ["Overtime to replacement leave", "OT ke cuti gantian"], "ot.amend": ["Overtime amended", "OT dipinda"],
};

/* 19-11-2026 - the reason a correction was made, when the audit row carries one */
const reasonOf = (detail: string | null) => { try { const o = detail ? JSON.parse(detail) as { reason?: unknown } : null; return typeof o?.reason === "string" ? o.reason : null; } catch { return null; } };

/** One person's day - the drawer the Overview, Records and the Roster open. */
export function PersonDayDrawer({ target, onClose, goExceptions }: { target: { id: number; day: string } | null; onClose: () => void; goExceptions: () => void }) {
  const reg = useCachedApi<DayRegister>(target ? `/staff/attendance/day?date=${target.day}` : null, true, ["attendance"]);
  const { user } = usePortal();
  /* 19-11-2026 - who may correct here: the server's attendance_correct, never on your own record */
  const canCorrect = holds("attendance_correct", ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"].includes(user.role)) && target?.id !== user.id;
  const p: PersonDay | null = target ? reg.data?.staff.find((x) => x.id === target.id) ?? null : null;
  const [tab, setTab] = useState<Tab>("details");
  const [audit, setAudit] = useState<{ id: number; rows: AuditRow[] | null; failed: boolean } | null>(null);
  const [seen, setSeen] = useState(target?.id ?? null);
  if ((target?.id ?? null) !== seen) { setSeen(target?.id ?? null); setTab("details"); }
  useEffect(() => {
    if (!target || tab !== "audit" || audit?.id === target.id) return;
    let live = true;
    void api<{ entries: AuditRow[] }>(`/staff/attendance/audit?user_id=${target.id}`).then((r) => { if (live) setAudit({ id: target.id, rows: r.ok && r.data ? r.data.entries : [], failed: !r.ok }); });
    return () => { live = false; };
  }, [target, tab, audit?.id]);
  const punches = p?.punches ?? [];
  const firstIn = punches.find((x) => x.type === "clock_in" && !x.pending);
  const lastOut = [...punches].reverse().find((x) => x.type === "clock_out" && !x.pending);
  const pending = punches.filter((x) => x.pending);
  const locLine = (label: string, x: typeof firstIn) => {
    const l = locText(x?.loc);
    return (
      <div className={css.kv}>
        <span>{label}{x ? ` · ${mytHm(x.at)}` : ""}</span>
        <strong className={l.tone === "ok" ? css.locOk : l.tone === "warn" ? css.locWarn : css.muted}>{l.text}{x?.gps && !x.gps.startsWith("no_location") ? ` · ${x.gps.split(",").slice(0, 2).join(", ")}` : ""}</strong>
      </div>
    );
  };
  const TABS: [Tab, string][] = [["details", L("Attendance Details", "Butiran Kehadiran")], ["punches", L("Punch History", "Sejarah Ketukan")], ["corrections", L("Corrections", "Pembetulan")], ["audit", L("Audit Log", "Log Audit")]];
  return (
    <SideDrawer open={!!target} onClose={onClose} wide title={p ? properName(p.name) : L("Attendance", "Kehadiran")}
      subtitle={p ? <span className={css.introRight}>{p.position ?? ""}{p ? <StatusChip p={p} /> : null}</span> : undefined}>
      {!target ? null : !p ? <SkelRows rows={5} /> : (
        <div className={css.drawer} data-testid="att-drawer">
          <span className={css.mode} role="group" aria-label={L("Record", "Rekod")}>
            {TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} data-testid={`att-drawer-${k}`}>{l}</button>)}
          </span>
          {tab === "details" && (
            <>
              <div className={css.kv}><strong>{dayLabel(target.day)}</strong><span className={css.muted}>{L("Scheduled: ", "Dijadualkan: ")}{p.shift_label ?? (p.verdict.status === "rest_day" ? L("rest day", "hari rehat") : "—")}</span></div>
              <div className={css.facts}>
                <div className={css.fact}><span>{L("Clock In", "Masuk")}</span><strong>{mytHm(p.first_in)}</strong></div>
                <div className={css.fact}><span>{L("Clock Out", "Keluar")}</span><strong>{mytHm(p.last_out)}</strong></div>
                <div className={css.fact}><span>{L("Working Hours", "Jam Bekerja")}</span><strong>{hm(p.worked_minutes)}</strong></div>
                <div className={css.fact}><span>{L("Status", "Status")}</span><strong><StatusChip p={p} /></strong></div>
              </div>
              {p.verdict.late && <p className={css.sub}>{L(`${p.verdict.lateMinutes} min after the start of the shift (grace ${reg.data?.grace_minutes ?? 0} min).`, `${p.verdict.lateMinutes} min selepas syif bermula (tempoh ihsan ${reg.data?.grace_minutes ?? 0} min).`)}</p>}
              {p.verdict.workedOffDay && <p className={css.sub}>{L("Punches on a rest day or holiday - kept for review, never dropped.", "Ketukan pada hari rehat atau cuti umum - disimpan untuk semakan, tidak dibuang.")}</p>}
              <p className={css.sectionTitle}>{L("Location evidence", "Bukti lokasi")}</p>
              <div>{locLine(L("Clock in", "Masuk"), firstIn)}{locLine(L("Clock out", "Keluar"), lastOut)}</div>
              <p className={css.sub}>{L(`Judged against ${reg.data?.site?.label ?? "the office"} (${reg.data?.site?.radius_m ?? "—"} m) when the punch was made. No photo is taken at a punch.`, `Dinilai berbanding ${reg.data?.site?.label ?? "pejabat"} (${reg.data?.site?.radius_m ?? "—"} m) semasa ketukan. Tiada foto diambil semasa ketukan.`)}</p>
            </>
          )}
          {tab === "punches" && (punches.length === 0 ? <p className={css.empty}>{L("No punch that day.", "Tiada ketukan pada hari itu.")}</p> : (
            <ol className={css.timeline} data-testid="att-punches">
              {punches.map((x) => (
                <li key={x.id}>
                  <strong>{mytHm(x.at)} · {x.type === "clock_in" ? L("Clock in", "Masuk") : L("Clock out", "Keluar")}</strong>
                  <span className={css.introRight}>
                    <span className={x.pending ? chipSmWarn : x.source === "punch" ? chipSmSuccess : chipSmInfo}>{x.pending ? L("Waiting for approval", "Menunggu kelulusan") : x.source === "manual" ? L("Manual", "Manual") : x.source === "amended" ? L("Amended", "Dipinda") : L("From On Shift", "Dari On Shift")}</span>
                    <span className={css.muted}>{locText(x.loc).text}</span>
                  </span>
                </li>
              ))}
            </ol>
          ))}
          {tab === "corrections" && (
            <>
              {pending.length === 0 ? <p className={css.empty}>{L("No correction request for this date.", "Tiada permohonan pembetulan untuk tarikh ini.")}</p> : (
                <ul className={css.list}>{pending.map((x) => <li key={x.id}><span className={css.listText}><strong>{L(`Forgotten ${x.type === "clock_in" ? "clock-in" : "clock-out"} at ${mytHm(x.at)}`, `${x.type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} terlupa pada ${mytHm(x.at)}`)}</strong><span className={css.sub}>{L("Counts for nothing until it is approved.", "Tidak dikira sehingga diluluskan.")}</span></span><span className={chipSmWarn}>{L("Pending", "Menunggu")}</span></li>)}</ul>
              )}
              {pending.length > 0 && <p className={css.boundary}>{L("A forgotten punch someone asked for is decided in ", "Ketukan terlupa yang dimohon diputuskan dalam ")}<button type="button" className={btnSm} onClick={goExceptions}>{L("Exceptions & Approvals", "Pengecualian & Kelulusan")}</button>{L(" - never by the person who asked.", " - bukan oleh pemohon.")}</p>}
              {canCorrect ? <DayCorrections key={`${target.id}:${target.day}`} userId={target.id} name={properName(p.name)} day={target.day} punches={punches} onChanged={() => reg.refresh()} />
                : <p className={css.sub}>{target.id === user.id ? L("Your own record is corrected by someone else.", "Rekod anda sendiri dibetulkan oleh orang lain.") : L("Corrections are made by the CEO, COO, CCO or HR.", "Pembetulan dibuat oleh CEO, COO, CCO atau HR.")}</p>}
            </>
          )}
          {tab === "audit" && (
            !audit || audit.id !== target.id ? <SkelRows rows={3} /> : audit.failed ? <p className={css.empty}>{L("The audit log could not be read just now.", "Log audit tidak dapat dibaca sekarang.")}</p> : (audit.rows ?? []).length === 0 ? <p className={css.empty}>{L("No attendance change recorded for this person.", "Tiada perubahan kehadiran direkod untuk orang ini.")}</p> : (
              <ol className={css.timeline} data-testid="att-audit">
                {(audit.rows ?? []).map((r) => { const why = reasonOf(r.detail); return <li key={r.id}><strong>{ACTION[r.action] ? L(ACTION[r.action]![0], ACTION[r.action]![1]) : r.action}</strong>{why && <span>{L("Reason: ", "Sebab: ")}{why}</span>}<span className={css.muted}>{dmyMYT(r.created_at)} · {r.user_name ?? "—"}</span></li>; })}
              </ol>
            )
          )}
          {tab !== "corrections" && <p className={css.sub}>{canCorrect ? <>{L("To fix a punch, open ", "Untuk membetulkan ketukan, buka ")}<button type="button" className={btnSm} onClick={() => setTab("corrections")} data-testid="att-go-correct">{L("Corrections", "Pembetulan")}</button></> : L("Read only. Records change only through a decided correction.", "Baca sahaja. Rekod berubah hanya melalui pembetulan yang diputuskan.")} <span className={chipSmNeutral}>{hhmm(p.verdict.start)}–{hhmm(p.verdict.end)}</span></p>}
        </div>
      )}
    </SideDrawer>
  );
}
