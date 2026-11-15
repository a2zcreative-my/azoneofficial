"use client";

/* v1.307.0 - THE ATTENDANCE OVERVIEW, ATTENDANCE WORKSPACE 4.0 (the CEO,
   14-11-2026: "approve as the recommendation and correct it the error issue";
   reference image 1). Real-time attendance, today's status and what needs
   attention - every word from THE verdict (worker/src/attendance-day.ts) via
   GET /staff/attendance/day, never a rule of this screen's own:

     four figures       Present today (of the people DUE today, never of the
                        headcount), Late arrivals, Missing punches (no
                        clock-out, or a forgotten punch waiting), On leave
     requires attention who is due and not in, yesterday's and today's open
                        clock-outs, forgotten punches waiting for a decision
     today's schedule   the viewer's own shift, today's holiday, the grace
     today's attendance one row a person: shift, in, out, hours, status and
                        where the first punch was made - as a word and a
                        distance, never a position
     quick actions      the other four views

   The fix this release is for: on Saturday 14 November 2026 the old
   Overview counted the seven staff on their rest day as "Not clocked in". A
   rest day, a holiday, approved leave and the time before a shift starts are
   none of them "not clocked in" now. Nothing here writes. */

import { useMemo, useState } from "react";
import { L, type User } from "@/components/portal/page-shared";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";
import { mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { STATUS, StatusChip, addDays, dayLabel, hhmm, hm, locText, mytHm, type DayRegister, type DayStatus, type PersonDay } from "./attendance-shared";
import css from "./attendance4.module.css";

export type AttView = "overview" | "records" | "roster" | "exceptions" | "reports";
const IN = new Set<DayStatus>(["present", "late", "on_shift", "missing_out"]);
const OFF = new Set<DayStatus>(["rest_day", "holiday"]);

export function AttendanceOverview({ user, open, openPerson }: { user: User; open: (v: AttView) => void; openPerson: (id: number, day: string) => void }) {
  const today = mytToday();
  const reg = useCachedApi<DayRegister>(`/staff/attendance/day?date=${today}`, true, ["attendance"]);
  const prev = useCachedApi<DayRegister>(`/staff/attendance/day?date=${addDays(today, -1)}`, true, ["attendance"]);
  const pend = useCachedApi<{ pending?: { id: number; user_id: number; name: string; type: string; created_at: string }[] }>("/staff/attendance/pending", true, ["attendance"]);
  const staff = useMemo(() => reg.data?.staff ?? [], [reg.data]);
  const due = staff.filter((p) => !OFF.has(p.verdict.status));
  const present = staff.filter((p) => IN.has(p.verdict.status));
  const late = staff.filter((p) => p.verdict.late);
  const onLeave = staff.filter((p) => p.verdict.status === "leave");
  const pendingList = pend.data?.pending ?? [];
  const missing = staff.filter((p) => p.verdict.status === "missing_out").length + pendingList.length;
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
  const busy = reg.loading && !reg.data;
  const grace = reg.data?.grace_minutes ?? 0;

  /* ---- requires attention ---- */
  type Att = { key: string; p: Pick<PersonDay, "id" | "name" | "position">; chip: [string, string]; what: string; when: string; day: string; action: "record" | "exceptions" };
  const attention: Att[] = [
    ...staff.filter((p) => p.verdict.status === "not_in").map((p): Att => ({ key: `n${p.id}`, p, chip: [chipSmDanger, L("Not yet clocked in", "Belum daftar masuk")], what: L(`No clock-in by ${hhmm((p.verdict.start ?? 0) + grace)}`, `Tiada daftar masuk menjelang ${hhmm((p.verdict.start ?? 0) + grace)}`), when: L(`${dayLabel(today)} (today)`, `${dayLabel(today)} (hari ini)`), day: today, action: "record" })),
    ...staff.filter((p) => p.verdict.status === "missing_out").map((p): Att => ({ key: `o${p.id}`, p, chip: [chipSmWarn, L("Missing clock-out", "Tiada daftar keluar")], what: L(`Checked in at ${mytHm(p.first_in)}, no check-out yet`, `Masuk pada ${mytHm(p.first_in)}, belum keluar`), when: L(`${dayLabel(today)} (today)`, `${dayLabel(today)} (hari ini)`), day: today, action: "record" })),
    ...(prev.data?.staff ?? []).filter((p) => p.verdict.status === "missing_out").map((p): Att => ({ key: `y${p.id}`, p, chip: [chipSmWarn, L("Missing clock-out", "Tiada daftar keluar")], what: L(`Checked in at ${mytHm(p.first_in)}, no check-out`, `Masuk pada ${mytHm(p.first_in)}, tiada daftar keluar`), when: L(`${dayLabel(addDays(today, -1))} (yesterday)`, `${dayLabel(addDays(today, -1))} (semalam)`), day: addDays(today, -1), action: "record" })),
    ...pendingList.map((x): Att => ({ key: `p${x.id}`, p: { id: x.user_id, name: x.name, position: null }, chip: [chipSmInfo, L("Pending correction", "Pembetulan menunggu")], what: L(`Forgotten ${x.type === "clock_in" ? "clock-in" : "clock-out"} claimed for ${mytHm(x.created_at)}`, `${x.type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} terlupa dituntut untuk ${mytHm(x.created_at)}`), when: dayLabel(x.created_at.slice(0, 10)), day: x.created_at.slice(0, 10), action: "exceptions" })),
  ];

  /* ---- today's schedule: the viewer's own day ---- */
  const me = staff.find((p) => p.id === user.id) ?? null;
  const holidayToday = staff.find((p) => p.holiday_name)?.holiday_name ?? null;

  /* ---- today's attendance ---- */
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [st, setSt] = useState<"" | DayStatus>("");
  const teams = [...new Set(staff.map((p) => p.department || p.position || "").filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const rows = staff.filter((p) => (!needle || p.name.toLowerCase().includes(needle)) && (!team || (p.department || p.position) === team) && (!st || p.verdict.status === st));
  const quick: [AppIconName, string, AttView][] = [
    ["users", L("View Team Today", "Lihat Pasukan Hari Ini"), "records"],
    ["chart", L("Attendance Report", "Laporan Kehadiran"), "reports"],
    ["verify", L("Exceptions & Approvals", "Pengecualian & Kelulusan"), "exceptions"],
    ["date", L("Shift Roster", "Roster Syif"), "roster"],
  ];

  return (
    <>
      <div className={css.intro}>
        <div className={css.headText}>
          <p className={css.pageTitle}>{L("Attendance Overview", "Gambaran Kehadiran")}</p>
          <p className={css.sub}>{L("Real-time attendance, today's status and items that require your attention.", "Kehadiran masa nyata, status hari ini dan perkara yang memerlukan perhatian anda.")}</p>
        </div>
        <span className={css.dateChip}><AppIcon name="date" />{dayLabel(today)}</span>
      </div>

      <KpiRow label={L("Today", "Hari ini")}>
        <KpiTile icon="users" tone="green" label={L("Present Today", "Hadir Hari Ini")} value={`${present.length} / ${due.length}`} busy={busy}
          sub={due.length ? L(`${pct(present.length, due.length)}% of staff due today`, `${pct(present.length, due.length)}% kakitangan yang bertugas`) : L("Nobody is due at work today", "Tiada sesiapa bertugas hari ini")} />
        <KpiTile icon="time" tone="gold" label={L("Late Arrivals", "Lewat Tiba")} value={late.length} busy={busy}
          sub={L(`${pct(late.length, due.length)}% of staff due · after ${grace} min grace`, `${pct(late.length, due.length)}% · selepas tempoh ihsan ${grace} min`)} />
        <KpiTile icon="warning" tone="red" label={L("Missing Punches", "Ketukan Tertinggal")} value={missing} busy={busy}
          sub={L("Pending action", "Menunggu tindakan")} onClick={() => open("exceptions")} />
        <KpiTile icon="holiday" tone="blue" label={L("On Leave Today", "Bercuti Hari Ini")} value={onLeave.length} busy={busy}
          sub={L(`${pct(onLeave.length, staff.length)}% of staff`, `${pct(onLeave.length, staff.length)}% kakitangan`)} />
      </KpiRow>

      <div className={css.split}>
        <section className={card} aria-label={L("Requires attention", "Perlu perhatian")} data-testid="att-attention">
          <div className={css.head}>
            <div className={css.headText}>
              <p className={css.title}>{L("Requires Attention", "Perlu Perhatian")}</p>
              <p className={css.sub}>{L("Attendance items that need your review or follow up.", "Perkara kehadiran yang perlu disemak atau disusuli.")}</p>
            </div>
            <button type="button" className={btnSm} onClick={() => open("exceptions")}>{L("View all", "Lihat semua")} <AppIcon name="next" /></button>
          </div>
          {busy ? <SkelRows rows={3} /> : attention.length === 0 ? <p className={css.empty}>{L("Nothing needs attention — everyone due is in, and no punch is waiting.", "Tiada yang perlu perhatian — semua yang bertugas sudah masuk, tiada ketukan menunggu.")}</p> : (
            <ul className={css.list}>
              {attention.slice(0, 8).map((a) => (
                <li key={a.key} data-testid="att-attention-row">
                  <Avatar name={a.p.name} size="sm" />
                  <span className={css.listText}><strong>{properName(a.p.name)}</strong><span className={css.sub}>{a.p.position ?? ""}</span></span>
                  <span className={a.chip[0]}>{a.chip[1]}</span>
                  <span className={css.listText}><span>{a.what}</span><span className={css.sub}>{a.when}</span></span>
                  <button type="button" className={btnSm} onClick={() => (a.action === "exceptions" ? open("exceptions") : openPerson(a.p.id, a.day))}>{a.action === "exceptions" ? L("Review", "Semak") : L("Open record", "Buka rekod")}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label={L("Today's schedule", "Jadual hari ini")} data-testid="att-schedule">
          <div className={css.headText}>
            <p className={css.title}>{L("Today's Schedule", "Jadual Hari Ini")}</p>
            <p className={css.sub}>{L("Your published working hours for today.", "Waktu bekerja anda yang diterbitkan untuk hari ini.")}</p>
          </div>
          <div className={css.kv}><span>{L("Work hours", "Waktu kerja")}</span><strong>{me ? (me.shift_label ?? (me.verdict.status === "rest_day" ? L("Rest day", "Hari rehat") : "—")) : "—"}</strong></div>
          <div className={css.kv}><span>{L("Working pattern", "Corak kerja")}</span><strong>{me?.pattern ?? "—"}</strong></div>
          <div className={css.kv}><span>{L("Public holiday", "Cuti umum")}</span><strong>{holidayToday ?? "—"}</strong></div>
          <div className={css.kv}><span>{L("Late after", "Lewat selepas")}</span><strong>{L(`start + ${grace} min`, `mula + ${grace} min`)}</strong></div>
          <div className={css.quick}>
            {quick.map(([icon, label, v]) => <button key={v} type="button" className={css.qa} onClick={() => open(v)}><AppIcon name={icon} />{label}</button>)}
          </div>
        </section>
      </div>

      <section className={card} aria-label={L("Today's attendance", "Kehadiran hari ini")} data-testid="att-today">
        <div className={css.head}>
          <div className={css.headText}>
            <p className={css.title}>{L("Today's Attendance", "Kehadiran Hari Ini")}</p>
            <p className={css.sub}>{L("Every person against their own published shift. Where a punch was made shows as a word and a distance.", "Setiap orang berbanding syif mereka sendiri. Lokasi ketukan ditunjuk sebagai perkataan dan jarak.")}</p>
          </div>
        </div>
        <div className={css.filters}>
          <input type="search" className={`${inputClassSm} ${css.wide}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff…", "Cari kakitangan…")} aria-label={L("Search staff", "Cari kakitangan")} />
          <select className={selectClassSm} value={team} onChange={(e) => setTeam(e.target.value)} aria-label={L("Team", "Pasukan")}>
            <option value="">{L("All teams", "Semua pasukan")}</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={selectClassSm} value={st} onChange={(e) => setSt(e.target.value as "" | DayStatus)} aria-label={L("Status", "Status")} data-testid="att-status-filter">
            <option value="">{L("All status", "Semua status")}</option>
            {(Object.keys(STATUS) as DayStatus[]).map((k) => <option key={k} value={k}>{L(STATUS[k][0], STATUS[k][1])}</option>)}
          </select>
        </div>
        {busy ? <SkelRows rows={5} /> : <TodayRows rows={rows} openPerson={(id) => openPerson(id, today)} />}
      </section>
    </>
  );
}

/** One row a person - a table on a wide screen, cards on a phone. */
export function TodayRows({ rows, openPerson }: { rows: PersonDay[]; openPerson: (id: number) => void }) {
  if (rows.length === 0) return <p className={css.empty}>{L("Nobody matches.", "Tiada yang sepadan.")}</p>;
  const loc = (p: PersonDay) => { const l = locText(p.punches?.find((x) => x.type === "clock_in" && !x.pending)?.loc); return <span className={l.tone === "ok" ? css.locOk : l.tone === "warn" ? css.locWarn : css.muted}>{l.text}</span>; };
  return (
    <>
      <div className={`${css.tableWrap} erp-desktop-only`}>
        <table className={css.table} data-testid="att-table">
          <thead><tr><th>{L("No.", "No.")}</th><th>{L("Staff", "Kakitangan")}</th><th>{L("Team / Role", "Pasukan / Peranan")}</th><th>{L("Shift (today)", "Syif (hari ini)")}</th><th>{L("Clock In", "Masuk")}</th><th>{L("Clock Out", "Keluar")}</th><th className={css.num}>{L("Working Hours", "Jam Bekerja")}</th><th>{L("Status", "Status")}</th><th>{L("Location", "Lokasi")}</th><th><span className="erp-sr-only">{L("Open", "Buka")}</span></th></tr></thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} data-testid="att-row">
                <td>{i + 1}</td>
                <td><span className={css.who}><strong>{properName(p.name)}</strong></span></td>
                <td className={css.muted}>{p.department || p.position || "—"}</td>
                <td>{p.shift_label ?? "—"}</td>
                <td>{p.first_in ? <span className={`${css.time} ${p.verdict.late ? css.timeLate : css.timeOk}`}>{mytHm(p.first_in)}</span> : "—"}</td>
                <td>{p.last_out ? <span className={`${css.time} ${css.timeOk}`}>{mytHm(p.last_out)}</span> : "—"}</td>
                <td className={css.num}>{hm(p.worked_minutes)}</td>
                <td><StatusChip p={p} /></td>
                <td>{loc(p)}</td>
                <td><button type="button" className={btnSm} onClick={() => openPerson(p.id)}>{L("View", "Lihat")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={`${css.cards} erp-phone-only`}>
        {rows.map((p) => (
          <li key={p.id}>
            <button type="button" className={css.cardRow} onClick={() => openPerson(p.id)} data-testid="att-card">
              <span className={css.cardTop}><strong>{properName(p.name)}</strong><StatusChip p={p} /></span>
              <span className={css.cardMeta}><span>{p.shift_label ?? "—"}</span><span>{L("In", "Masuk")} {mytHm(p.first_in)}</span><span>{L("Out", "Keluar")} {mytHm(p.last_out)}</span><span>{hm(p.worked_minutes)}</span>{loc(p)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
