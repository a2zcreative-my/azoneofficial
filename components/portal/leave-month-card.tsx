"use client";

/* v1.184.0 - LEAVE APPLICATION, THIS MONTH (the owner's reference,
   22-10-2026: a card listing the month's applications - the person, their
   reason - on the Dashboard). The owner's explicit choice: EVERY staff
   member sees the whole company's applications for the month, reasons
   included (GET /staff/leave/month is the one route that returns them; its
   comment names the PDPA trade-off). The card decides nothing: a row opens
   the Leave tab, where approvers act and everyone sees their own history.
   Read through useCachedApi on the `leave` topic, so a new application or a
   decision anywhere refreshes it without a reload. */

import { useState } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { Avatar } from "@/components/ui/avatar";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { leaveTypeL } from "@/components/portal/page-shared";
import { getLang } from "@/lib/i18n";
import { dmy } from "@/lib/format";
import { btnSm, card } from "@/lib/ui-styles";
import css from "./leave-month-card.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface MonthLeave {
  id: number; user_id: number; name: string; photo_key: string | null; position: string | null;
  type: string; start_date: string; end_date: string; days: number; day_part: string | null;
  status: "pending" | "approved" | "rejected"; reason: string | null; created_at: string;
}

const STATUS_CHIP: Record<MonthLeave["status"], string> = {
  pending: "erp-chip-warning", approved: "erp-chip-success", rejected: "erp-chip-neutral",
};
const SHOW_FIRST = 6;

export function LeaveMonthCard({ go }: { go: (tab: "Leave") => void }) {
  const view = useCachedApi<{ month: string; leave: MonthLeave[] }>("/staff/leave/month", true, ["leave"]);
  const [all, setAll] = useState(false);
  const rows = view.data?.leave ?? [];
  const shown = all ? rows : rows.slice(0, SHOW_FIRST);
  const statusL = (s: MonthLeave["status"]) =>
    s === "pending" ? L("pending", "menunggu") : s === "approved" ? L("approved", "diluluskan") : L("rejected", "ditolak");
  const span = (r: MonthLeave) =>
    r.start_date === r.end_date ? dmy(r.start_date) : `${dmy(r.start_date)} – ${dmy(r.end_date)}`;
  return (
    <div className={card}>
      <PanelTitle icon="holiday" className={css.title}>
        {L("Leave Application", "Permohonan Cuti")}
        <span
          className={css.info}
          title={L("Everyone's leave applications this month. A row opens the Leave tab.", "Permohonan cuti semua orang bulan ini. Satu baris membuka tab Cuti.")}
          aria-label={L("Everyone's leave applications this month", "Permohonan cuti semua orang bulan ini")}
        >
          <AppIcon name="info" />
        </span>
        <StaleHint show={view.stale} className={css.stale} />
      </PanelTitle>
      {view.loading ? (
        <div className={css.list} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={css.row}>
              <Skel className={css.avatarSkel} />
              <div className={css.lines}><Skel className={css.lineSkel} /><Skel className={css.lineSkelShort} /></div>
            </div>
          ))}
        </div>
      ) : view.failed && !view.data ? (
        <p className="erp-meta erp-mt-2" role="alert">
          {L("This month's applications could not be loaded.", "Permohonan bulan ini tidak dapat dimuatkan.")}{" "}
          <button type="button" className={btnSm} onClick={view.refresh}>{L("Try again", "Cuba lagi")}</button>
        </p>
      ) : rows.length === 0 ? (
        <p className="erp-meta erp-mt-2">{L("No leave applications this month.", "Tiada permohonan cuti bulan ini.")}</p>
      ) : (
        <>
          <ul className={css.list}>
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" className={css.row} onClick={() => go("Leave")} title={L("Open Leave", "Buka Cuti")}>
                  <Avatar name={r.name} photoKey={r.photo_key} size="md" />
                  <span className={css.lines}>
                    <span className={css.name}>{r.name}</span>
                    <span className={css.reason}>
                      {L("Reason", "Sebab")} : {r.reason?.trim() || leaveTypeL(r.type)}
                    </span>
                    <span className={css.when}>
                      {span(r)} · {r.days} {L(r.days === 1 ? "day" : "days", "hari")} · {leaveTypeL(r.type)}
                    </span>
                  </span>
                  <span className={`erp-chip erp-chip-sm ${STATUS_CHIP[r.status]} ${css.status}`}>{statusL(r.status)}</span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > SHOW_FIRST && (
            <button type="button" className={`${btnSm} erp-mt-2`} onClick={() => setAll((v) => !v)}>
              {all ? L("Show fewer", "Tunjuk kurang") : L(`Show all ${rows.length}`, `Tunjuk semua ${rows.length}`)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
