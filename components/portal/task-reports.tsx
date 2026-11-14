"use client";

/* v1.306.0 - THE WRITTEN TASK REPORT, MOVED (the CEO, 14-11-2026, HR
   Workspace 4.0 H-1: "Daily, Weekly and Monthly operational reporting must
   have one authoritative home: Tasks -> Reports & Archive"). This is the
   component the HR page's Reports tab drew since v1.192.0, moved as it was:
   the same submit, the same draft-keeping failure, the same list and period
   filter, the same route (GET/POST /staff/task-reports), the same table
   (task_reports) and the same permission (task_reports). Every report ever
   submitted is listed here. Nothing was copied - HR no longer draws it. */

import { useCallback, useEffect, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Skel, SkelText } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import { btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmSuccess, fieldLabel, inputClassSm, selectClassSm, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./task-reports.module.css";

/* ================= Reports ================= */

type Report = { id: number; period: string; report_date: string; content: string; author: string };
type Period = "all" | "daily" | "weekly" | "monthly";
const PERIOD: Record<string, [string, string]> = { daily: ["Daily", "Harian"], weekly: ["Weekly", "Mingguan"], monthly: ["Monthly", "Bulanan"] };
const PAGE = 10;

/** The task report (v1.4.x, HrPanel until v1.192.0): the submit form and
    the list management reads. Submit, its draft-keeping failure and the
    list are as they were; the list gained a period filter and shows more
    than five. */
export function TaskReports() {
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
          <textarea id="task-report-text" className={`${inputClassSm} ${css.textarea}`} rows={6}
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
