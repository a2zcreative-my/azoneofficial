"use client";

/* v1.306.0 - THE HR OVERVIEW, HR WORKSPACE 4.0 (the CEO, 14-11-2026: "ONE
   FUNCTION. ONE AUTHORITATIVE MODULE"; claude/HR-WORKSPACE-4.0-BLUEPRINT.md,
   reference image "HR Overview"). People matters and employment milestones -
   not a second Tasks, Leave or Payroll dashboard:

     three figures       Staff on record (the Staff record) · Probation
                         reviews due · Leaving / exit records
     HR lifecycle        joining checklists still open, offboarding records,
     worklist            probation reviews due - each opens its own row in
                         Employee Lifecycle; the document templates open
                         HR Policies & Settings
     upcoming people     probation & confirmation, last days, birthdays (the
     milestones          day and month only)
     the boundary note   leave decisions in Leave, overtime in Attendance,
                         task reports in Tasks -> Reports & Archive

   What left (v1.192.0's Overview): the Leave, Claims and Payroll tiles, the
   month's leave chart, the Desk's leave / claims / OT items, Approve Leave /
   Approve Claims / Process Payroll, and the task-report activity. Their
   modules own them; nothing they hold was touched. Every figure here is a
   row the server already sends this role; a figure it does not send (the
   lifecycle, to a role without hr_manage) is left out, never shown as 0. The
   reference's sample people and its "illustrative" labels are not used. */

import { useEffect, useState } from "react";
import type { DashSummary } from "@/components/portal/dashboard";
import { L } from "@/components/portal/page-shared";
import { JOINING_LABEL, type PeopleTab } from "@/components/portal/people-panel";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import type { TabName } from "@/lib/portal-tabs";
import { btnSm, card, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./hr-page.module.css";

export type HrView = "overview" | "lifecycle" | "calendar" | "policies";

type People = {
  today: string;
  joining: { id: number; name: string; joined_on: string; open: string[] }[];
  leaving: { id: number; name: string; left_on: string; open: string[] }[];
  probation: { id: number; name: string; review: { ends_on: string; outcome: string | null } | null }[];
  joining_keys: string[];
  pending_migration?: boolean;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** a birthday as the day and month only - never the year (privacy-safe) */
const dayMonth = (md: string) => `${Number(md.slice(3, 5))} ${MON[Number(md.slice(0, 2)) - 1] ?? ""}`;

/** One plain GET, kept in component state only (never the device cache). */
function usePlain<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; denied: boolean }>({ path: null, data: null, denied: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    void api<T>(path).then((r) => { if (live) setState({ path, data: r.ok ? r.data : null, denied: !r.ok }); });
    return () => { live = false; };
  }, [path]);
  const settled = state.path === path;
  return { data: settled ? state.data : null, done: !path || settled };
}

export function HrOverview({ admin, go, canOpen, open }: {
  admin: boolean;
  go: (t: TabName) => void;
  canOpen: (t: string) => boolean;
  open: (v: HrView, sub?: PeopleTab) => void;
}) {
  const today = mytToday();
  const horizon = addDays(today, 30);
  const sum = useCachedApi<DashSummary>("/staff/dashboard/summary", true, ["users"]);
  const people = usePlain<People>(admin ? "/staff/people/overview" : null);
  const bdays = usePlain<{ birthdays: { name: string; birthday: string }[] }>("/staff/birthdays");
  const s = sum.data;
  const p = people.data && !people.data.pending_migration ? people.data : null;

  const due = p ? p.probation.filter((x) => x.review && !x.review.outcome && x.review.ends_on <= horizon) : [];
  const openJoin = p ? p.joining.filter((j) => j.open.length > 0) : [];
  const openLeave = p ? p.leaving.filter((u) => u.open.length > 0) : [];
  const lastDays = p ? p.leaving.filter((u) => u.left_on >= today && u.left_on <= horizon) : [];
  const md = today.slice(5);
  const mdH = horizon.slice(5);
  const nextBdays = (bdays.data?.birthdays ?? [])
    .map((b) => ({ name: b.name, md: b.birthday.slice(5) }))
    .filter((b) => /^\d{2}-\d{2}$/.test(b.md) && (md <= mdH ? b.md >= md && b.md <= mdH : b.md >= md || b.md <= mdH))
    .sort((a, b) => ((a.md >= md ? 0 : 1) - (b.md >= md ? 0 : 1)) || a.md.localeCompare(b.md));

  const staffBtn = canOpen("Staff Details") ? <button type="button" className={btnSm} onClick={() => go("Staff Details")} data-testid="hr-open-staff">{L("Open Staff Directory", "Buka Direktori Kakitangan")} <AppIcon name="next" /></button> : null;

  return (
    <>
      <div className={css.intro}>
        <div className={css.headText}>
          <p className={css.eyebrow}>{L("HR only · Staff lifecycle", "HR sahaja · Kitaran kakitangan")}</p>
          <p className={css.pageTitle}>{L("HR Overview", "Gambaran HR")}</p>
          <p className={css.sub}>{L("People matters and employment milestones — not a second Tasks, Leave or Payroll dashboard.", "Hal kakitangan dan peristiwa pekerjaan — bukan papan pemuka kedua untuk Tugasan, Cuti atau Gaji.")}</p>
        </div>
        {staffBtn}
      </div>

      <KpiRow label={L("HR at a glance", "HR sepintas lalu")}>
        <KpiTile icon="users" tone="navy" label={L("Staff on record", "Kakitangan dalam rekod")} value={s?.staff_total ?? 0} busy={!s}
          sub={L("From the Staff record", "Daripada rekod Kakitangan")} onClick={canOpen("Staff Details") ? () => go("Staff Details") : undefined} />
        {admin && (
          <KpiTile icon="verify" tone="gold" label={L("Probation reviews due", "Semakan percubaan perlu")} value={due.length} busy={!people.done}
            sub={L("Ending within 30 days, or past", "Tamat dalam 30 hari, atau sudah lepas")} onClick={() => open("lifecycle", "probation")} />
        )}
        {admin && (
          <KpiTile icon="offboard" tone="red" label={L("Leaving / exit records", "Rekod keluar")} value={p?.leaving.length ?? 0} busy={!people.done}
            sub={L(`${openLeave.length} with steps open`, `${openLeave.length} dengan langkah terbuka`)} onClick={() => open("lifecycle", "leaving")} />
        )}
      </KpiRow>

      <div className={css.split}>
        <section className={card} aria-label={L("HR lifecycle worklist", "Senarai kerja kitaran HR")} data-testid="hr-worklist">
          <div className={css.head}>
            <div className={css.headText}>
              <p className={css.title}>{L("HR lifecycle worklist", "Senarai kerja kitaran HR")}</p>
              <p className={css.sub}>{L("Only matters owned by HR — joining, probation, documents and exit clearance.", "Hanya perkara milik HR — kemasukan, percubaan, dokumen dan pelepasan keluar.")}</p>
            </div>
          </div>
          {!admin ? <p className={css.empty}>{L("The lifecycle worklist is kept by HR admin, the CEO and admins.", "Senarai kerja kitaran disimpan oleh pentadbir HR, CEO dan pentadbir.")}</p>
            : !people.done ? <SkelRows rows={3} />
            : people.data?.pending_migration ? <p className={css.empty}>{L("The lifecycle needs database update 0144.", "Kitaran memerlukan kemas kini pangkalan data 0144.")}</p>
            : (
              <ul className={css.work}>
                {openJoin.map((j) => (
                  <li key={`j${j.id}`} data-testid="hr-work-row">
                    <span className={css.workText}><strong>{L("Employee joining checklist", "Senarai semak kemasukan")}</strong>
                      <span className={css.sub}>{j.name} · {L("open: ", "terbuka: ")}{j.open.map((k) => L(JOINING_LABEL[k]?.[0] ?? k, JOINING_LABEL[k]?.[1] ?? k)).join(", ")}</span></span>
                    <span className={chipSmWarn}>{(p?.joining_keys.length ?? 0) - j.open.length}/{p?.joining_keys.length ?? 0}</span>
                    <button type="button" className={btnSm} onClick={() => open("lifecycle", "joining")}>{L("View record", "Lihat rekod")} <AppIcon name="next" /></button>
                  </li>
                ))}
                {due.map((x) => (
                  <li key={`p${x.id}`} data-testid="hr-work-row">
                    <span className={css.workText}><strong>{L("Probation review", "Semakan percubaan")}</strong>
                      <span className={css.sub}>{x.name} · {x.review!.ends_on < today ? L(`ended ${dmy(x.review!.ends_on)}, not decided`, `tamat ${dmy(x.review!.ends_on)}, belum diputuskan`) : L(`ends ${dmy(x.review!.ends_on)}`, `tamat ${dmy(x.review!.ends_on)}`)}</span></span>
                    <span className={x.review!.ends_on < today ? chipSmWarn : chipSmNeutral}>{L("Review", "Semak")}</span>
                    <button type="button" className={btnSm} onClick={() => open("lifecycle", "probation")}>{L("View record", "Lihat rekod")} <AppIcon name="next" /></button>
                  </li>
                ))}
                {openLeave.map((u) => (
                  <li key={`x${u.id}`} data-testid="hr-work-row">
                    <span className={css.workText}><strong>{L("Employee offboarding record", "Rekod keluar pekerja")}</strong>
                      <span className={css.sub}>{u.name} · {L(`last day ${dmy(u.left_on)} · ${u.open.length} step(s) open`, `hari terakhir ${dmy(u.left_on)} · ${u.open.length} langkah terbuka`)}</span></span>
                    <span className={chipSmWarn}>{L("Review", "Semak")}</span>
                    <button type="button" className={btnSm} onClick={() => open("lifecycle", "leaving")}>{L("View record", "Lihat rekod")} <AppIcon name="next" /></button>
                  </li>
                ))}
                <li data-testid="hr-work-row">
                  <span className={css.workText}><strong>{L("Employment document templates", "Templat dokumen pekerjaan")}</strong>
                    <span className={css.sub}>{L("Letters, checklists and the probation standard HR issues from", "Surat, senarai semak dan standard percubaan yang digunakan HR")}</span></span>
                  <span className={chipSmNeutral}>HR</span>
                  <button type="button" className={btnSm} onClick={() => open("policies")}>{L("Manage", "Urus")} <AppIcon name="next" /></button>
                </li>
                {openJoin.length + due.length + openLeave.length === 0 && <li className={css.allClear}><AppIcon name="success" />{L("No joining, probation or exit step is waiting.", "Tiada langkah kemasukan, percubaan atau keluar yang menunggu.")}</li>}
              </ul>
            )}
          <p className={css.boundary} data-testid="hr-boundary">
            {L("Leave decisions belong in ", "Keputusan cuti milik ")}<strong>{L("Leave", "Cuti")}</strong>{L(". Overtime belongs in ", ". Lebih masa milik ")}<strong>{L("Attendance", "Kehadiran")}</strong>{L(". All operational task reports belong in ", ". Semua laporan tugasan operasi milik ")}<strong>{L("Tasks → Reports & Archive", "Tugasan → Laporan & Arkib")}</strong>.
          </p>
        </section>

        <section className={card} aria-label={L("Upcoming people milestones", "Peristiwa kakitangan akan datang")} data-testid="hr-milestones">
          <div className={css.head}>
            <div className={css.headText}>
              <p className={css.title}>{L("Upcoming people milestones", "Peristiwa kakitangan akan datang")}</p>
              <p className={css.sub}>{L("The next 30 days — not a second company calendar.", "30 hari akan datang — bukan kalendar syarikat kedua.")}</p>
            </div>
            <button type="button" className={btnSm} onClick={() => open("calendar")}>{L("View calendar", "Lihat kalendar")} <AppIcon name="next" /></button>
          </div>
          <ul className={css.work}>
            {admin && (
              <li>
                <span className={css.workText}><strong>{L("Probation & confirmation", "Percubaan & pengesahan")}</strong>
                  <span className={css.sub}>{due.length ? due.slice(0, 3).map((x) => `${x.name} ${dmy(x.review!.ends_on)}`).join(" · ") : L("Reviews are scheduled in Employee Lifecycle.", "Semakan dijadualkan dalam Kitaran Pekerja.")}</span></span>
                <span className={due.length ? chipSmWarn : chipSmSuccess}>{L(`${due.length} due`, `${due.length} perlu`)}</span>
                <button type="button" className={btnSm} onClick={() => open("lifecycle", "probation")}>{L("View", "Lihat")} <AppIcon name="next" /></button>
              </li>
            )}
            {admin && (
              <li>
                <span className={css.workText}><strong>{L("Joining & leaving dates", "Tarikh masuk & keluar")}</strong>
                  <span className={css.sub}>{lastDays.length ? lastDays.map((u) => L(`${u.name}: last day ${dmy(u.left_on)}`, `${u.name}: hari terakhir ${dmy(u.left_on)}`)).join(" · ") : L("No last day in the next 30 days. Dates come from the Staff record.", "Tiada hari terakhir dalam 30 hari. Tarikh daripada rekod Kakitangan.")}</span></span>
                <button type="button" className={btnSm} onClick={() => open("lifecycle", "leaving")}>{L("View", "Lihat")} <AppIcon name="next" /></button>
              </li>
            )}
            <li>
              <span className={css.workText}><strong>{L("Employee birthdays", "Hari lahir pekerja")}</strong>
                <span className={css.sub}>{!bdays.done ? "…" : nextBdays.length ? nextBdays.slice(0, 4).map((b) => `${properName(b.name)} · ${dayMonth(b.md)}`).join(" · ") : L("None in the next 30 days.", "Tiada dalam 30 hari akan datang.")}</span></span>
              <button type="button" className={btnSm} onClick={() => open("calendar")}>{L("View", "Lihat")} <AppIcon name="next" /></button>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
