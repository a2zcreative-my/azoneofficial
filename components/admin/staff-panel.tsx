"use client";

/**
 * Staff administration inside /admin (v1.4.11).
 *
 * Admin and super admin hold `hr_manage` on the API, but until now the only
 * surface for it was the staff portal. This panel gives the admin interface
 * direct authority over leave — the most decision-heavy staff function — and
 * a bridge to every other staff module, which admins can open in /portal with
 * full rights (only customers are barred from the portal).
 *
 * Every action here is the same guarded API the portal uses: approvals are
 * permission-checked server-side, audit-logged, and notify the requester.
 */

import { makeApi } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { dmy as dmyD } from "@/lib/format";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang } from "@/lib/i18n";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);




interface LeaveRow {
  id: number;
  user_name: string;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string;
  status: string;
  stage?: string;
  review_comment?: string;
}

const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR", hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO", pending_final: "Awaiting CEO",
  approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};
// Display-only BM twins of STAGE_LABEL — stage keys stay English for logic.
const STAGE_LABEL_MS: Record<string, string> = {
  applied: "Menunggu HR", hr_reviewed: "Menunggu pra-kelulusan",
  pre_approved: "Menunggu CEO", pending_final: "Menunggu CEO",
  approved: "Diluluskan", rejected: "Ditolak", cancelled: "Dibatalkan",
};
const LEAVE_TYPE_MS: Record<string, string> = {
  annual: "tahunan", medical: "perubatan", emergency: "kecemasan",
  unpaid: "tanpa gaji", replacement: "gantian",
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "approved"
      ? "bg-green-600/10 text-green-700"
      : value === "pending"
        ? "bg-amber-500/10 text-amber-700"
        : value === "rejected"
          ? "bg-destructive/10 text-destructive"
          : "bg-secondary text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {value}
    </span>
  );
}

/** ISO date → DD-MM-YYYY. */

export function StaffPanel() {
  const { node: toastNode } = useSaveToast(); // v1.19.0: show() went with the approve buttons
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [comment, setComment] = useState<Record<number, string>>({});
  const [error] = useState(""); // v1.19.0: setter went with the approve buttons

  const load = useCallback(async () => {
    const res = await api<{ leave: LeaveRow[] }>(`/leave?all=1`);
    if (res.ok && res.data) setRows(res.data.leave);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // v1.19.0: decide() removed with the buttons — approvals live in the portal Leave tab.


  const inFlight = ["applied", "hr_reviewed", "pre_approved", "pending_final"];
  const pending = rows.filter((r) => inFlight.includes(r.stage ?? ""));
  const decided = rows.filter((r) => !inFlight.includes(r.stage ?? ""));

  const leaveCard = (r: LeaveRow, withActions: boolean) => (
    <li key={r.id} className="border-border rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {r.user_name}
          <span className="text-muted-foreground font-normal">
            {" "}· {L(`${r.type} leave`, `cuti ${LEAVE_TYPE_MS[r.type] ?? r.type}`)} · {dmyD(r.start_date)} → {dmyD(r.end_date)} ({r.days}{" "}
            {r.days === 1 ? L("day", "hari") : L("days", "hari")})
          </span>
        </span>
        <span className="text-muted-foreground text-xs">{L(STAGE_LABEL[r.stage ?? ""] ?? r.status, STAGE_LABEL_MS[r.stage ?? ""] ?? r.status)}</span>
      </div>
      {r.reason && (
        <p className="text-muted-foreground mt-1.5 text-sm">{L("Reason:", "Sebab:")} {r.reason}</p>
      )}
      {r.review_comment && (
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Review note:", "Nota semakan:")} {r.review_comment}
        </p>
      )}
      {withActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="border-input bg-background w-64 rounded-lg border px-2 py-1.5 text-xs"
            placeholder={L("Comment (optional — the requester sees it)", "Komen (pilihan — pemohon akan melihatnya)")}
            value={comment[r.id] ?? ""}
            onChange={(e) => setComment((c) => ({ ...c, [r.id]: e.target.value }))}
          />
          {/* v1.19.0 (consolidation C1): approve/reject buttons REMOVED from this
              surface — they PATCHed the same endpoint as the portal Leave tab but
              WITHOUT the stage filtering, letting an admin skip the HR → COO/CCO →
              CEO chain. Approvals happen in the portal Leave tab only. */}
          <a className="text-gold-deep text-xs font-semibold underline-offset-2 hover:underline" href="/portal">
            {L("Decide in the portal Leave tab →", "Buat keputusan di tab Cuti portal →")}
          </a>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      <div className={card}>
        <p className="text-sm font-semibold">
          {L("Leave administration", "Pentadbiran cuti")}
          {pending.length > 0 && (
            <span className="bg-amber-500/10 ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
              {pending.length} {L("pending", "menunggu")}
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Annual · medical · emergency · unpaid · replacement. Decisions are audit-logged and the requester is notified with your comment.",
            "Tahunan · perubatan · kecemasan · tanpa gaji · gantian. Keputusan direkodkan dalam log audit dan pemohon dimaklumkan bersama komen anda.",
          )}
        </p>
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <ul className="mt-4 space-y-2">
          {pending.length === 0 && (
            <li className="text-muted-foreground text-sm">{L("No pending requests.", "Tiada permohonan menunggu.")}</li>
          )}
          {pending.map((r) => leaveCard(r, true))}
        </ul>

        {decided.length > 0 && (
          <>
            <p className="text-muted-foreground mt-6 text-xs font-semibold tracking-wide uppercase">
              {L("History", "Sejarah")}
            </p>
            <ul className="mt-2 space-y-2">
              {decided.slice(0, 12).map((r) => leaveCard(r, false))}
            </ul>
          </>
        )}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">{L("All staff modules", "Semua modul kakitangan")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Your admin account has full rights in every staff module. These open in the staff portal:",
            "Akaun admin anda mempunyai hak penuh dalam setiap modul kakitangan. Ini dibuka dalam portal kakitangan:",
          )}
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [L("HR — attendance verification", "HR — pengesahan kehadiran"), L("Shift-checked table for all staff", "Jadual disemak ikut syif untuk semua kakitangan")],
            [L("Leave", "Cuti"), L("Same requests as above, portal view", "Permohonan sama seperti di atas, paparan portal")],
            [L("Inventory & postage", "Inventori & pos"), L("Stock, shipments, materials", "Stok, penghantaran, bahan")],
            [L("Commercial", "Komersial"), L("BD pipeline (open/pending/KIV/closed)", "Saluran BD (terbuka/menunggu/KIV/tutup)")],
            [L("Operations", "Operasi"), L("Daily ops + sales reports", "Operasi harian + laporan jualan")],
            [L("Overview", "Ringkasan"), L("Company-wide read-only monitor", "Pemantau baca sahaja seluruh syarikat")],
          ].map(([title, desc]) => (
            <li key={title}>
              <a
                href="/portal"
                className="border-border hover:border-foreground/40 block rounded-lg border px-3 py-2.5 transition-colors"
              >
                <span className="block text-sm font-medium">{title}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {desc}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
