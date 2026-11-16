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

import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { api } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, inputClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface QuoteApproval { limit_cents: number | null; pending: { id: number }[]; approved: number[]; can_set: boolean; can_approve?: boolean }

export function QuoteApprovalLimit({ qa, onChanged }: { qa: QuoteApproval; onChanged: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  if (!qa.can_set) return null;
  const save = async (limit: number | null) => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/quotes/approval/limit`, { method: "PUT", body: JSON.stringify({ limit_cents: limit }) });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not saved", "Tidak disimpan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), limit ? L(`Quotations above ${fmtRM(limit)} now wait for your approval`, `Sebut harga melebihi ${fmtRM(limit)} kini menunggu kelulusan anda`) : L("Approval limit off", "Had kelulusan dimatikan"));
    setV(""); setOpen(false); onChanged();
  };
  const state = qa.limit_cents
    ? L(`Quotation approval: on, above ${fmtRM(qa.limit_cents)}`, `Kelulusan sebut harga: hidup, melebihi ${fmtRM(qa.limit_cents)}`)
    : L("Quotation approval: off (only you see this)", "Kelulusan sebut harga: mati (hanya anda nampak ini)");
  /* v1.324.0 (Global UI System, inline forms to drawers) - the setting reads as
     one line on the page; its field opens on demand, with the same checks, the
     same buttons and the same PUT */
  return (
    <div className={`${css.form} ${css.dueStrip}`} data-testid="qa-limit">
      {toastNode}
      <span className={css.field}>{state}</span>
      <button type="button" className={btnSm} onClick={() => setOpen(true)} data-testid="qa-limit-open">{qa.limit_cents ? L("Change", "Tukar") : L("Set a limit", "Tetapkan had")}</button>
      <SideDrawer open={open} onClose={() => { setOpen(false); setV(""); }} dirty="auto" title={L("Quotation approval", "Kelulusan sebut harga")} subtitle={state}
        footer={<>
          {qa.limit_cents ? <button type="button" className={btnSm} disabled={busy} onClick={() => void save(null)}>{L("Turn off", "Matikan")}</button> : null}
          <button type="button" className={btnSmPrimary} disabled={busy || !(Number(v) >= 1)} onClick={() => void save(Math.round(Number(v) * 100))}>{qa.limit_cents ? L("Change limit", "Tukar had") : L("Turn on", "Hidupkan")}</button>
        </>}>
        <p className="erp-meta">{L("A quotation raised or revised after this whose total is above the limit waits for your approval before it is sent from the portal. Printing is unchanged.", "Sebut harga yang dibuat atau disemak selepas ini dengan jumlah melebihi had menunggu kelulusan anda sebelum dihantar dari portal. Cetakan tidak berubah.")}</p>
        <label className={css.field}>{L("Limit in RM", "Had dalam RM")}
          <input className={inputClassSm} inputMode="decimal" value={v} placeholder={L("Limit in RM, e.g. 10000", "Had dalam RM, cth. 10000")} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
      </SideDrawer>
    </div>
  );
}
