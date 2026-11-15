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
     Corrections         that day's forgotten punches; they are decided in
                         Exceptions & Approvals, never here
     Audit Log           the person's attendance and overtime events
                         (GET /staff/attendance/audit - read only)

   Export: this day as CSV, and the month's punches for Payroll (the
   existing /attendance/export, payroll_export). Nothing here writes. */

import { useEffect, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
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
import css from "./attendance4.module.css";

const LEGEND: [string, string, DayStatus[]][] = [
  ["Present", "Hadir", ["present", "on_shift"]], ["Late", "Lewat", ["late"]], ["Missing clock-in", "Tiada daftar masuk", ["not_in", "absent", "pending"]],
  ["Missing clock-out", "Tiada daftar keluar", ["missing_out"]], ["On leave", "Bercuti", ["leave"]], ["Off day", "Hari cuti", ["rest_day", "holiday"]],
];
const PAGE = 10;

export function AttendanceRecords({ canExport, openPerson, day, setDay }: { canExport: boolean; openPerson: (id: number, day: string) => void; day: string; setDay: (d: string) => void }) {
  const reg = useCachedApi<DayRegister>(`/staff/attendance/day?date=${day}`, true, ["attendance"]);
  const staff = reg.data?.staff ?? [];
  const [team, setTeam] = useState("");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [leg, setLeg] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const teams = [...new Set(staff.map((p) => p.department || p.position || "").filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const rows = staff.filter((p) => (!team || (p.department || p.position) === team) && (!who || String(p.id) === who)
    && (!needle || `${p.name} ${p.position ?? ""}`.toLowerCase().includes(needle)) && (leg === null || LEGEND[leg]![2].includes(p.verdict.status)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const today = mytToday();
  const exportDay = () => downloadCsv(`attendance-${day}.csv`, [
    ["Date", "Staff", "Position", "Department", "Scheduled shift", "Clock in", "Clock out", "Hours", "Status", "Late (min)"],
    ...rows.map((p) => [day, p.name, p.position ?? "", p.department ?? "", p.shift_label ?? "", mytHm(p.first_in), mytHm(p.last_out), (p.worked_minutes / 60).toFixed(2), p.verdict.status === "leave" ? leaveWord(p.leave_type) : STATUS[p.verdict.status][0], p.verdict.lateMinutes || ""]),
  ]);
  return (
    <section className={card} aria-label={L("Attendance records", "Rekod kehadiran")} data-testid="att-records">
      <div className={css.head}>
        <div className={css.headText}>
          <p className={css.title}>{L("Attendance Records", "Rekod Kehadiran")}</p>
          <p className={css.sub}>{L("Daily attendance, working hours and verification for all staff - each against their own published shift.", "Kehadiran harian, jam bekerja dan pengesahan untuk semua kakitangan - berbanding syif masing-masing.")}</p>
        </div>
        <span className={css.introRight}>
          <button type="button" className={btnSm} onClick={exportDay} data-testid="att-export-day"><AppIcon name="download" />{L("Export day (CSV)", "Eksport hari (CSV)")}</button>
          {canExport && <a className={btnSm} href={`/api/v1/staff/attendance/export?month=${day.slice(0, 7)}`}><AppIcon name="download" />{L("Month for Payroll", "Bulan untuk Gaji")}</a>}
        </span>
      </div>
      <div className={css.filters}>
        <span className={css.introRight}>
          <button type="button" className={btnSm} onClick={() => { setDay(addDays(day, -1)); setPage(0); }} aria-label={L("Previous day", "Hari sebelum")}><AppIcon name="previous" /></button>
          <input type="date" className={inputClassSm} value={day} max={today} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setPage(0); } }} aria-label={L("Date", "Tarikh")} data-testid="att-date" />
          <button type="button" className={btnSm} disabled={day >= today} onClick={() => { setDay(addDays(day, 1)); setPage(0); }} aria-label={L("Next day", "Hari seterusnya")}><AppIcon name="next" /></button>
        </span>
        <select className={selectClassSm} value={team} onChange={(e) => { setTeam(e.target.value); setPage(0); }} aria-label={L("Team / Department", "Pasukan / Jabatan")}>
          <option value="">{L("All teams", "Semua pasukan")}</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={selectClassSm} value={who} onChange={(e) => { setWho(e.target.value); setPage(0); }} aria-label={L("Staff", "Kakitangan")}>
          <option value="">{L("All staff", "Semua kakitangan")}</option>{staff.map((p) => <option key={p.id} value={p.id}>{properName(p.name)}</option>)}
        </select>
        <input type="search" className={`${inputClassSm} ${css.wide}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={L("Search staff or position…", "Cari kakitangan atau jawatan…")} aria-label={L("Search", "Cari")} />
      </div>
      <div className={css.legend} role="group" aria-label={L("Status", "Status")}>
        {LEGEND.map(([en, ms, ks], i) => (
          <button key={en} type="button" aria-pressed={leg === i} onClick={() => { setLeg(leg === i ? null : i); setPage(0); }} data-testid="att-legend">
            {L(en, ms)} <span className={css.muted}>{staff.filter((p) => ks.includes(p.verdict.status)).length}</span>
          </button>
        ))}
      </div>
      <p className={`${css.sub} ${css.dayNote}`}>{dayLabel(day)}{reg.data ? L(` · late after start + ${reg.data.grace_minutes} min`, ` · lewat selepas mula + ${reg.data.grace_minutes} min`) : ""}</p>
      {reg.loading && !reg.data ? <SkelRows rows={6} /> : <TodayRows rows={shown} openPerson={(id) => openPerson(id, day)} />}
      <div className={css.pager}>
        <span>{L(`Showing ${rows.length ? page * PAGE + 1 : 0}–${Math.min(rows.length, page * PAGE + PAGE)} of ${rows.length}`, `Menunjukkan ${rows.length ? page * PAGE + 1 : 0}–${Math.min(rows.length, page * PAGE + PAGE)} daripada ${rows.length}`)}</span>
        <span className={css.introRight}>
          <button type="button" className={btnSm} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={L("Previous page", "Halaman sebelum")}><AppIcon name="previous" /></button>
          <span>{page + 1} / {pages}</span>
          <button type="button" className={btnSm} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
        </span>
      </div>
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

/** One person's day - the drawer the Overview, Records and the Roster open. */
export function PersonDayDrawer({ target, onClose, goExceptions }: { target: { id: number; day: string } | null; onClose: () => void; goExceptions: () => void }) {
  const reg = useCachedApi<DayRegister>(target ? `/staff/attendance/day?date=${target.day}` : null, true, ["attendance"]);
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
              <p className={css.boundary}>{L("Corrections are decided in ", "Pembetulan diputuskan dalam ")}<button type="button" className={btnSm} onClick={goExceptions}>{L("Exceptions & Approvals", "Pengecualian & Kelulusan")}</button>{L(" - never by the person who asked.", " - bukan oleh pemohon.")}</p>
            </>
          )}
          {tab === "audit" && (
            !audit || audit.id !== target.id ? <SkelRows rows={3} /> : audit.failed ? <p className={css.empty}>{L("The audit log could not be read just now.", "Log audit tidak dapat dibaca sekarang.")}</p> : (audit.rows ?? []).length === 0 ? <p className={css.empty}>{L("No attendance change recorded for this person.", "Tiada perubahan kehadiran direkod untuk orang ini.")}</p> : (
              <ol className={css.timeline} data-testid="att-audit">
                {(audit.rows ?? []).map((r) => <li key={r.id}><strong>{ACTION[r.action] ? L(ACTION[r.action]![0], ACTION[r.action]![1]) : r.action}</strong><span className={css.muted}>{dmyMYT(r.created_at)} · {r.user_name ?? "—"}</span></li>)}
              </ol>
            )
          )}
          <p className={css.sub}>{L("Read only. Records change only through a decided correction.", "Baca sahaja. Rekod berubah hanya melalui pembetulan yang diputuskan.")} <span className={chipSmNeutral}>{hhmm(p.verdict.start)}–{hhmm(p.verdict.end)}</span></p>
        </div>
      )}
    </SideDrawer>
  );
}
