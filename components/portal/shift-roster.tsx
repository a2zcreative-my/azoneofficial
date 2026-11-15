"use client";

/* v1.307.0 - SHIFT ROSTER, ATTENDANCE WORKSPACE 4.0 (the CEO, A-2: reference
   image B). ONE roster, computed - never copied - from what already decides a
   working day:

     the working-hour pattern each person is assigned (Shift Templates; the
     pattern editor that lived in Attendance Settings, moved here unchanged),
     roster commitments (lives, task blocks, sales duty), approved leave
     (Leave) and the holidays each person is entitled to (HR Calendar).

   Week or month; the team for its readers, your own row otherwise
   (GET /staff/attendance/roster). The roster is always "published": it is
   the patterns in force. Day-by-day overrides, a draft state, Copy Roster
   and Bulk Assign need a database change and wait for phase 3 (A-7) - they
   are not drawn, so nothing on screen does nothing. */

import { useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AttendanceAdminPanel } from "@/components/portal/lazy-panels";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { downloadCsv } from "@/lib/csv";
import { mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmSuccess, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { addDays, hm, leaveWord } from "./attendance-shared";
import css from "./attendance4.module.css";

type Day = { d: string; kind: "work" | "rest" | "leave" | "holiday" | "not_employed"; label?: string | null; pattern?: string | null; minutes?: number; leave_type?: string; holiday?: string; partial_leave?: string | null; assigned?: boolean };
type Roster = { from: string; to: string; days: string[]; scope: "team" | "own"; staff: { id: number; name: string; role: string; position: string | null; department: string | null; days: Day[] }[] };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_MS = ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mondayOf = (day: string) => { const d = new Date(`${day}T00:00:00Z`); const w = (d.getUTCDay() + 6) % 7; return addDays(day, -w); };
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

export function ShiftRoster({ canTemplates, role, openPerson }: { canTemplates: boolean; role: string; openPerson?: (id: number, day: string) => void }) {
  const today = mytToday();
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => mondayOf(today));
  const from = mode === "week" ? anchor : `${anchor.slice(0, 7)}-01`;
  const to = mode === "week" ? addDays(anchor, 6) : (() => { const [y, m] = from.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
  const r = useCachedApi<Roster>(`/staff/attendance/roster?from=${from}&to=${to}`, true, ["attendance"]);
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [tpl, setTpl] = useState(false);
  const all = r.data?.staff ?? [];
  const teams = [...new Set(all.map((p) => p.department || p.position || "").filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const staff = all.filter((p) => (!team || (p.department || p.position) === team) && (!needle || p.name.toLowerCase().includes(needle)));
  const days = r.data?.days ?? [];
  const totalOf = (p: Roster["staff"][number]) => p.days.reduce((n, d) => n + (d.kind === "work" ? d.minutes ?? 0 : 0), 0);
  const scheduled = staff.filter((p) => p.days.some((d) => d.kind === "work")).length;
  const onLeave = staff.filter((p) => p.days.some((d) => d.kind === "leave")).length;
  const restDays = staff.reduce((n, p) => n + p.days.filter((d) => d.kind === "rest").length, 0);
  const unassigned = staff.filter((p) => p.days.every((d) => d.kind !== "work" && d.kind !== "leave" && d.kind !== "holiday")).length;
  const holidays = [...new Set(staff.flatMap((p) => p.days.filter((d) => d.kind === "holiday").map((d) => d.d)))].length;
  const step = (n: number) => setAnchor(mode === "week" ? addDays(anchor, 7 * n) : (() => { const [y, m] = anchor.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); })());
  const cell = (d: Day) => {
    if (d.kind === "work") return <span className={`${css.cell} ${d.assigned ? css.cellAssigned : css.cellWork}`} title={d.pattern ?? undefined}><strong>{d.label}</strong>{d.partial_leave ? <span>{leaveWord(d.partial_leave)} ½</span> : mode === "week" ? <span className={css.muted}>{d.pattern ?? ""}</span> : null}</span>;
    if (d.kind === "leave") return <span className={`${css.cell} ${css.cellLeave}`}>{leaveWord(d.leave_type)}</span>;
    if (d.kind === "holiday") return <span className={`${css.cell} ${css.cellHoliday}`}>{mode === "week" ? <>{L("Public holiday", "Cuti umum")}<span>{d.holiday}</span></> : L("PH", "CU")}</span>;
    if (d.kind === "rest") return <span className={`${css.cell} ${css.cellRest}`}>{L("Off", "Rehat")}</span>;
    return <span className={`${css.cell} ${css.cellNone}`}>—</span>;
  };
  const exportCsv = () => downloadCsv(`roster-${from}-to-${to}.csv`, [
    ["Staff", "Position", ...days, "Total hours"],
    ...staff.map((p) => [p.name, p.position ?? "", ...p.days.map((d) => d.kind === "work" ? d.label ?? "" : d.kind === "leave" ? leaveWord(d.leave_type) : d.kind === "holiday" ? `Holiday: ${d.holiday ?? ""}` : d.kind === "rest" ? "Off" : ""), (totalOf(p) / 60).toFixed(2)]),
  ]);
  const totalAll = staff.reduce((n, p) => n + totalOf(p), 0);
  return (
    <>
      <section className={card} aria-label={L("Shift roster", "Roster syif")}>
        <div className={css.head}>
          <div className={css.headText}>
            <p className={css.title}>{L("Shift Roster", "Roster Syif")}</p>
            <p className={css.sub}>{L("The expected working schedule: each person's working-hour pattern with approved leave and holidays laid over it.", "Jadual kerja yang dijangka: corak waktu kerja setiap orang dengan cuti diluluskan dan cuti umum.")}</p>
          </div>
          <span className={css.introRight}>
            {canTemplates && <button type="button" className={btnSm} onClick={() => setTpl(true)} data-testid="roster-templates"><AppIcon name="document" />{L("Shift Templates", "Templat Syif")}</button>}
            <button type="button" className={btnSm} onClick={exportCsv} data-testid="roster-export"><AppIcon name="download" />{L("Export", "Eksport")}</button>
          </span>
        </div>
      </section>
      <KpiRow label={L("This period", "Tempoh ini")}>
        <KpiTile icon="users" tone="blue" label={L("Total Staff", "Jumlah Kakitangan")} value={staff.length} busy={!r.data} />
        <KpiTile icon="date" tone="green" label={L("Scheduled", "Dijadualkan")} value={scheduled} busy={!r.data} sub={staff.length ? L(`${Math.round((scheduled / staff.length) * 100)}% of staff`, `${Math.round((scheduled / staff.length) * 100)}% kakitangan`) : undefined} />
        <KpiTile icon="holiday" tone="blue" label={L("On Leave", "Bercuti")} value={onLeave} busy={!r.data} sub={L("people this period", "orang dalam tempoh ini")} />
        <KpiTile icon="time" tone="navy" label={L("Rest Days", "Hari Rehat")} value={restDays} busy={!r.data} sub={L(`${holidays} public holiday${holidays === 1 ? "" : "s"}`, `${holidays} cuti umum`)} />
        <KpiTile icon="warning" tone="red" label={L("Unassigned", "Belum Ditetapkan")} value={unassigned} busy={!r.data} sub={L("No working day in the period", "Tiada hari bekerja dalam tempoh")} />
      </KpiRow>
      <section className={card} aria-label={L("Roster", "Roster")} data-testid="roster">
        <div className={css.filters}>
          <select className={selectClassSm} value={team} onChange={(e) => setTeam(e.target.value)} aria-label={L("Team", "Pasukan")}>
            <option value="">{L("All teams", "Semua pasukan")}</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className={css.introRight}>
            <button type="button" className={btnSm} onClick={() => step(-1)} aria-label={L("Previous", "Sebelum")}><AppIcon name="previous" /></button>
            <strong data-testid="roster-period">{mode === "week" ? `${dm(from)} – ${dm(to)} ${to.slice(0, 4)}` : `${MON[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`}</strong>
            <button type="button" className={btnSm} onClick={() => step(1)} aria-label={L("Next", "Seterusnya")}><AppIcon name="next" /></button>
          </span>
          <span className={chipSmSuccess} title={L("The roster is the working-hour patterns in force", "Roster ialah corak waktu kerja yang berkuat kuasa")}>{L("Published · working-hour patterns", "Diterbitkan · corak waktu kerja")}</span>
          {r.data?.scope === "team" && <input type="search" className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff…", "Cari kakitangan…")} aria-label={L("Search staff", "Cari kakitangan")} />}
          <span className={css.mode} role="group" aria-label={L("Period", "Tempoh")}>
            <button type="button" aria-pressed={mode === "week"} onClick={() => { setMode("week"); setAnchor(mondayOf(from)); }} data-testid="roster-week">{L("Week", "Minggu")}</button>
            <button type="button" aria-pressed={mode === "month"} onClick={() => { setMode("month"); setAnchor(`${anchor.slice(0, 7)}-01`); }} data-testid="roster-month">{L("Month", "Bulan")}</button>
          </span>
        </div>
        {!r.data ? <SkelRows rows={6} /> : (
          <div className={css.roster}>
            <table className={css.rosterTable} data-testid="roster-table">
              <thead><tr>
                <th className={css.left}>{L("Staff", "Kakitangan")}</th>
                {days.map((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th key={d} className={d === today ? css.colToday : undefined}>{L(DOW[w]!, DOW_MS[w]!)}<br /><span className={css.muted}>{mode === "week" ? dm(d) : Number(d.slice(8, 10))}</span></th>; })}
                <th>{L("Total", "Jumlah")}</th>
              </tr></thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.id} data-testid="roster-row">
                    <td className={css.left}><span className={css.who}><strong>{properName(p.name)}</strong><span>{[p.position, p.department].filter(Boolean).join(" · ")}</span></span></td>
                    {p.days.map((d) => <td key={d.d}>{openPerson && d.d <= today && d.kind !== "not_employed" ? <button type="button" className={css.cellBtn} onClick={() => openPerson(p.id, d.d)} aria-label={`${p.name} ${d.d}`}>{cell(d)}</button> : cell(d)}</td>)}
                    <td className={css.rosterTotal}>{hm(totalOf(p))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={css.legendRow}>
          <span><span className={`${css.swatch} ${css.cellWork}`} />{L("Office / work day", "Hari bekerja")}</span>
          <span><span className={`${css.swatch} ${css.cellAssigned}`} />{L("With a roster commitment (live, task, sales duty)", "Dengan komitmen roster (live, tugasan, tugas jualan)")}</span>
          <span><span className={`${css.swatch} ${css.cellLeave}`} />{L("Approved leave", "Cuti diluluskan")}</span>
          <span><span className={`${css.swatch} ${css.cellHoliday}`} />{L("Public holiday", "Cuti umum")}</span>
          <span><span className={`${css.swatch} ${css.cellRest}`} />{L("Off / rest day", "Cuti / hari rehat")}</span>
          <strong className={css.legendTotal}>{L(`Total scheduled hours: ${hm(totalAll)}`, `Jumlah jam dijadualkan: ${hm(totalAll)}`)}</strong>
        </div>
        <p className={css.boundary}>{L("Change a person's hours in Shift Templates (from a date, so a month already measured never moves). Live sessions and task blocks are scheduled in Tasks → Calendar; leave in Leave; holidays in HR → Calendar & Holidays.", "Tukar waktu seseorang dalam Templat Syif (dari satu tarikh, supaya bulan yang telah diukur tidak berubah). Sesi live dan blok tugasan dijadualkan dalam Tugasan → Kalendar; cuti dalam Cuti; cuti umum dalam HR → Kalendar & Cuti Umum.")}</p>
      </section>
      {canTemplates && (
        <SideDrawer open={tpl} onClose={() => setTpl(false)} wide title={L("Shift Templates", "Templat Syif")} subtitle={L("Working-hour patterns and who works which, from a date", "Corak waktu kerja dan siapa bekerja mengikut corak mana, dari satu tarikh")}>
          {tpl && <AttendanceAdminPanel role={role} areas={["hours"]} showPending={false} bare />}
        </SideDrawer>
      )}
    </>
  );
}
