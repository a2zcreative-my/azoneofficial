"use client";

/**
 * v1.181.17 - THE QUOTATION APPROVAL LIMIT (ERP roadmap, phase 5).
 *
 * OFF until the CEO sets it. With a limit, a quotation raised or revised
 * after that moment whose total is above it shows "Awaiting CEO approval"
 * in place of Send PDF, and sits on the CEO's Desk until he approves that
 * revision. A new revision needs approving again. PDF printing stays as it
 * is; the gate is on sending it to the customer from the portal.
 * Turning it off removes every effect at once.
 */

import { useState } from "react";

import { useSaveToast } from "@/components/ui/save-toast";
import { api } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, inputClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface QuoteApproval { limit_cents: number | null; pending: { id: number }[]; approved: number[]; can_set: boolean; can_approve?: boolean }

export function QuoteApprovalLimit({ qa, onChanged }: { qa: QuoteApproval; onChanged: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  if (!qa.can_set) return null;
  const save = async (limit: number | null) => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/quotes/approval/limit`, { method: "PUT", body: JSON.stringify({ limit_cents: limit }) });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not saved", "Tidak disimpan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), limit ? L(`Quotations above ${fmtRM(limit)} now wait for your approval`, `Sebut harga melebihi ${fmtRM(limit)} kini menunggu kelulusan anda`) : L("Approval limit off", "Had kelulusan dimatikan"));
    setV(""); onChanged();
  };
  return (
    <div className={`${css.form} ${css.dueStrip}`}>
      {toastNode}
      <label className={css.field}>
        {qa.limit_cents
          ? L(`Quotation approval: on, above ${fmtRM(qa.limit_cents)}`, `Kelulusan sebut harga: hidup, melebihi ${fmtRM(qa.limit_cents)}`)
          : L("Quotation approval: off (only you see this)", "Kelulusan sebut harga: mati (hanya anda nampak ini)")}
        <input className={inputClassSm} inputMode="decimal" value={v} placeholder={L("Limit in RM, e.g. 10000", "Had dalam RM, cth. 10000")} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} />
      </label>
      <button type="button" className={btnSm} disabled={busy || !(Number(v) >= 1)} onClick={() => void save(Math.round(Number(v) * 100))}>{qa.limit_cents ? L("Change limit", "Tukar had") : L("Turn on", "Hidupkan")}</button>
      {qa.limit_cents ? <button type="button" className={btnSm} disabled={busy} onClick={() => void save(null)}>{L("Turn off", "Matikan")}</button> : null}
    </div>
  );
}
