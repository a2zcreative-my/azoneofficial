"use client";

/* v1.306.0 - THE WRITTEN TASK REPORT, MOVED (the CEO, 14-11-2026, HR
   Workspace 4.0 H-1: "Daily, Weekly and Monthly operational reporting must
   have one authoritative home: Tasks -> Reports & Archive"). The same route
   (GET/POST /staff/task-reports), the same table (task_reports) and the same
   permission (task_reports). Every report ever submitted is listed here.

   v1.337.0 - SUBMITTED REPORTS, ONE VIEW (the CEO, 17-11-2026: "Move Submit
   Report into a clickable modal/drawer. Keep daily, weekly and monthly
   reporting ... Fit the workspace within one viewport, with internal
   scrolling/pagination"). The register of reports beside the chosen report,
   held to one screen from 1024px; Submit Report is a drawer from the
   register's head. Nothing about a report changed: the same fields (daily,
   weekly or monthly; operational, project or design; the date; the text), the
   same submit that KEEPS the draft and says why when it fails, the same review
   by management (never its author). Read through the cached read the
   Reports & Archive strip uses, so a submit or a review moves the figures. */

import { useMemo, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { type PageSize } from "@/components/ui/pagination-controls";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { downloadCsv } from "@/lib/csv";
import { dmy, mytToday } from "@/lib/format";
import { btnSm, btnSmPrimary, chipSmInfo, chipSmSuccess, fieldLabel, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./task-reports.module.css";

/* v1.315.0 (Tasks 5.0 Gate 4, 0200) - the type, and the review by management (never its author) */
type Report = { id: number; period: string; report_date: string; content: string; author: string; created_at?: string | null; created_by?: number | null; kind?: string; status?: string; reviewer?: string | null; reviewed_at?: string | null; review_note?: string | null };
type Reply = { reports: Report[]; can_review?: boolean; me?: number };
const KIND: Record<string, [string, string]> = { operational: ["Operational", "Operasi"], project: ["Project", "Projek"], design: ["Design", "Reka bentuk"] };
const PERIOD: Record<string, [string, string]> = { daily: ["Daily", "Harian"], weekly: ["Weekly", "Mingguan"], monthly: ["Monthly", "Bulanan"] };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Daily Operational Report" - the report's own words, never an invented title */
const titleOf = (r: Report) => L(`${PERIOD[r.period]?.[0] ?? r.period} ${KIND[r.kind ?? "operational"]?.[0] ?? ""} Report`, `Laporan ${KIND[r.kind ?? "operational"]?.[1] ?? ""} ${PERIOD[r.period]?.[1] ?? r.period}`).replace(/\s+/g, " ");
/** the period the report covers, from its own date */
const periodOf = (r: Report) => r.period === "monthly" ? `${MONTHS[Number(r.report_date.slice(5, 7)) - 1] ?? ""} ${r.report_date.slice(0, 4)}`
  : r.period === "weekly" ? L(`Week of ${dmy(r.report_date)}`, `Minggu ${dmy(r.report_date)}`) : dmy(r.report_date);
const submittedAt = (r: Report) => (r.created_at ? new Date(`${r.created_at.replace(" ", "T")}Z`).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }) : dmy(r.report_date));
const reviewed = (r: Report) => r.status === "reviewed";

/** The written task report: the register, the chosen report, and Submit Report in a drawer. */
export function TaskReports() {
  const read = useCachedApi<Reply>("/staff/task-reports", true, ["task_reports"]);
  const reports = useMemo(() => read.data?.reports ?? [], [read.data]);
  const can = { review: Boolean(read.data?.can_review), me: read.data?.me ?? null };
  const denied = read.failed && !read.data;
  const loaded = !!read.data || read.failed;

  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<"" | "daily" | "weekly" | "monthly">("");
  const [status, setStatus] = useState<"" | "submitted" | "reviewed">("");
  const [picked, setPicked] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ period: "daily", report_date: mytToday(), content: "", kind: "operational" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [reviewing, setReviewing] = useState<number | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();

  const needle = q.trim().toLowerCase();
  /* ONE definition of what is visible: the table and the export both read it */
  const rows = useMemo(() => reports.filter((r) => (!period || r.period === period) && (!status || (status === "reviewed" ? reviewed(r) : !reviewed(r)))
    && (!needle || [r.author ?? "", r.content, titleOf(r), periodOf(r)].some((x) => x.toLowerCase().includes(needle)))), [reports, period, status, needle]);
  const fkey = `${needle}|${period}|${status}`;
  const [seenKey, setSeenKey] = useState(fkey);
  if (fkey !== seenKey) { setSeenKey(fkey); setPage(1); }
  const shown = rows.find((r) => r.id === picked) ?? rows[0] ?? null;

  const submit = async () => {
    if (!draft.content.trim()) return;
    /* v1.40.0 (AUDIT M14): a failed submit KEEPS the draft and says why. */
    setBusy(true); setProblem("");
    const res = await api<{ error?: { message?: string } }>(`/staff/task-reports`, { method: "POST", body: JSON.stringify(draft) });
    setBusy(false);
    if (!res.ok) { setProblem(res.data?.error?.message ?? L("Report was not saved — you may not have access to task reports.", "Laporan tidak disimpan — anda mungkin tiada akses kepada laporan tugasan.")); return; }
    toast(L("Report submitted", "Laporan dihantar"), L(`${PERIOD[draft.period]?.[0] ?? ""} report for ${dmy(draft.report_date)} - management sees it now.`, `Laporan ${PERIOD[draft.period]?.[1] ?? ""} untuk ${dmy(draft.report_date)} - pengurusan melihatnya sekarang.`));
    setDraft((d) => ({ ...d, content: "" }));
    setFormOpen(false); setPicked(null);
    read.refresh();
  };
  const review = async (r: Report) => {
    setReviewing(r.id);
    const res = await api<{ error?: { message?: string } }>(`/staff/task-reports/${r.id}/review`, { method: "POST", body: JSON.stringify({}) });
    setReviewing(null);
    if (!res.ok) { toast(L("Not reviewed", "Tidak disemak"), res.data?.error?.message ?? L("Try again", "Cuba lagi"), "error"); return; }
    toast(L("Marked reviewed", "Ditanda disemak"), titleOf(r));
    read.refresh();
  };
  const exportCsv = () => downloadCsv(`task-reports-${mytToday()}.csv`, [
    ["Report", "Period", "Type", "Date", "Author", "Submitted", "Status", "Reviewed by", "Report text"],
    ...rows.map((r) => [titleOf(r), PERIOD[r.period]?.[0] ?? r.period, KIND[r.kind ?? "operational"]?.[0] ?? r.kind ?? "", r.report_date, r.author, r.created_at ?? "", reviewed(r) ? "Reviewed" : "Submitted", r.reviewer ?? "", r.content]),
  ]);

  const statusChip = (r: Report) => <span className={reviewed(r) ? chipSmSuccess : chipSmInfo} data-testid="report-status">{reviewed(r) ? L("Reviewed", "Disemak") : L("Submitted", "Dihantar")}</span>;
  const cols: TableCol<Report>[] = [
    { key: "report", label: L("Report / Period", "Laporan / Tempoh"), main: true, cell: (r) => <span className={css.cellText}><strong>{titleOf(r)}</strong><small>{periodOf(r)}</small></span> },
    { key: "author", label: L("Author", "Penulis"), cell: (r) => r.author ?? "—" },
    { key: "submitted", label: L("Submitted", "Dihantar"), cell: (r) => <span className={css.nowrap}>{submittedAt(r)}</span> },
    { key: "status", label: L("Status", "Status"), cell: statusChip },
  ];

  return (
    <>
      {toastNode}
      <WorkspaceSplit testid="reports-split" ratio="60-40">
        <SplitPane testid="task-reports-list" title={L("Submitted Reports", "Laporan Dihantar")} label={L("Submitted reports", "Laporan dihantar")}
          sub={L("Daily, weekly and monthly reports, newest first.", "Laporan harian, mingguan dan bulanan, terbaru dahulu.")}
          actions={<>
            <button type="button" className={btnSm} onClick={exportCsv} disabled={rows.length === 0} data-testid="reports-export"><AppIcon name="download" />{L("Export", "Eksport")}</button>
            <button type="button" className={btnSmPrimary} onClick={() => { setProblem(""); setFormOpen(true); }} data-testid="report-submit-open"><AppIcon name="add" />{L("Submit Report", "Hantar Laporan")}</button>
          </>}
          toolbar={<>
            <label className={css.search}><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search reports…", "Cari laporan…")} aria-label={L("Search reports", "Cari laporan")} data-testid="reports-search" /></label>
            <select className={selectClassSm} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label={L("Period", "Tempoh")} data-testid="reports-period">
              <option value="">{L("All periods", "Semua tempoh")}</option>
              {(["daily", "weekly", "monthly"] as const).map((p) => <option key={p} value={p}>{L(PERIOD[p]![0], PERIOD[p]![1])}</option>)}
            </select>
            <select className={selectClassSm} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={L("Status", "Status")} data-testid="reports-status">
              <option value="">{L("All statuses", "Semua status")}</option>
              <option value="submitted">{L("Submitted", "Dihantar")}</option>
              <option value="reviewed">{L("Reviewed", "Disemak")}</option>
            </select>
          </>}>
          {denied ? <p className={css.empty}>{L("Task reports are for HR and management.", "Laporan tugasan untuk HR dan pengurusan.")}</p> : (
            <CompactTaskTable rows={rows} cols={cols} label={L("Submitted reports", "Laporan dihantar")} loading={!loaded} record="report" testid="reports-table" dense
              onOpen={setPicked} picked={shown?.id ?? null} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
              empty={<p className={css.empty}>{reports.length === 0 ? L("No reports yet - the first one you submit appears here.", "Belum ada laporan - yang pertama anda hantar dipaparkan di sini.") : L("No report matches that.", "Tiada laporan yang sepadan.")}</p>} />
          )}
        </SplitPane>
        <SplitPane testid="task-report-selected" title={L("Selected Report", "Laporan Dipilih")} label={L("Selected report", "Laporan dipilih")}
          actions={shown ? statusChip(shown) : undefined}>
          {!shown ? <p className={css.empty}>{loaded ? L("Choose a report in the register.", "Pilih laporan dalam daftar.") : ""}</p> : (
            <div className={css.detail} data-testid="report-detail" data-record={`report:${shown.id}`}>
              <div className={css.cellText}><strong className={css.big}>{titleOf(shown)}</strong><small>{periodOf(shown)} · {shown.author}</small></div>
              <dl className={css.facts}>
                <div><dt>{L("Period", "Tempoh")}</dt><dd>{PERIOD[shown.period] ? L(PERIOD[shown.period]![0], PERIOD[shown.period]![1]) : shown.period}</dd></div>
                <div><dt>{L("Type", "Jenis")}</dt><dd>{L(KIND[shown.kind ?? "operational"]?.[0] ?? shown.kind ?? "", KIND[shown.kind ?? "operational"]?.[1] ?? shown.kind ?? "")}</dd></div>
                <div><dt>{L("Submitted", "Dihantar")}</dt><dd>{submittedAt(shown)}</dd></div>
                <div><dt>{L("Management review", "Semakan pengurusan")}</dt><dd>{reviewed(shown) ? L(`Reviewed${shown.reviewer ? ` by ${shown.reviewer}` : ""}`, `Disemak${shown.reviewer ? ` oleh ${shown.reviewer}` : ""}`) : L("Awaiting", "Menunggu")}</dd></div>
              </dl>
              <p className={css.reportText} data-testid="report-text">{shown.content}</p>
              {reviewed(shown) && shown.review_note && <p className={css.meta}>{L("Note", "Nota")}: {shown.review_note}</p>}
              {can.review && !reviewed(shown) && shown.created_by !== can.me && (
                <div className={css.actions}><button type="button" className={btnSmPrimary} disabled={reviewing === shown.id} onClick={() => void review(shown)} data-testid="report-review">{L("Mark reviewed", "Tanda disemak")}</button></div>
              )}
            </div>
          )}
        </SplitPane>
      </WorkspaceSplit>

      <SideDrawer open={formOpen} onClose={() => setFormOpen(false)} dirty={draft.content.trim().length > 0} icon="edit"
        title={L("Submit a report", "Hantar laporan")} subtitle={L("Daily, weekly or monthly - visible to management.", "Harian, mingguan atau bulanan - dilihat oleh pengurusan.")}
        footer={<span className={css.actions}>
          <button type="button" className={btnSm} onClick={() => setFormOpen(false)}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy || !draft.content.trim()} onClick={() => void submit()} data-testid="report-submit">{busy ? L("Submitting…", "Menghantar…") : L("Submit report", "Hantar laporan")}</button>
        </span>}>
        <div className={css.form} data-testid="report-form">
          <label className={css.field}><span className={fieldLabel}>{L("Period", "Tempoh")}</span>
            <select className={selectClassSm} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} data-testid="report-period">
              <option value="daily">{L("Daily", "Harian")}</option>
              <option value="weekly">{L("Weekly", "Mingguan")}</option>
              <option value="monthly">{L("Monthly", "Bulanan")}</option>
            </select>
          </label>
          <label className={css.field}><span className={fieldLabel}>{L("Type", "Jenis")}</span>
            <select className={selectClassSm} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))} data-testid="report-kind">
              {Object.entries(KIND).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}
            </select>
          </label>
          <label className={css.field}><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
            <input type="date" className={inputClassSm} value={draft.report_date} onChange={(e) => setDraft((d) => ({ ...d, report_date: e.target.value }))} />
          </label>
          <label className={css.fieldFull}><span className={fieldLabel}>{L("Report", "Laporan")}</span>
            <textarea id="task-report-text" className={`${inputClassSm} ${css.textarea}`} rows={8}
              placeholder={L("What was completed, what is pending, what needs attention…", "Apa yang telah siap, apa yang tertunda, apa yang perlu perhatian…")}
              value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
          </label>
          {problem && <p className={css.problem} role="alert">{problem}</p>}
        </div>
      </SideDrawer>
    </>
  );
}
