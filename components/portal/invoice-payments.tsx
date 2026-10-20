"use client";

/**
 * v1.181.13 - PART PAYMENTS ON AN INVOICE (ERP roadmap, phase 1).
 *
 * The CEO chose, 20-10-2026: a part payment is RECORDED and the balance is
 * shown; the invoice stays unpaid. Aging, revenue, commission and the cash
 * book move only when somebody marks the invoice paid, exactly as before.
 * This panel therefore never marks anything paid. When the parts reach the
 * total it says so and points at the existing Mark paid, with the last
 * part's date to pick. A part is never deleted; it is voided with a reason.
 */

import { useEffect, useState } from "react";

import { usePrompt } from "@/components/ui/prompt-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSmPrimary, inputClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Part {
  id: number; amount_cents: number; received_on: string; method: string | null; reference: string | null;
  note: string | null; created_at: string; voided_at: string | null; void_reason: string | null;
  recorded_by: string | null; voided_by_name: string | null;
}
interface PayData {
  invoice: { id: number; doc_number: string; total_cents: number; payment_status: string | null };
  payments: Part[]; received_cents: number; balance_cents: number; can_record: boolean; pending_migration?: boolean;
}

/** The chip on a document row: an unpaid invoice that has parts recorded. */
export function PartPaidChip({ totalCents, receivedCents }: { totalCents: number; receivedCents?: number }) {
  if (!receivedCents || receivedCents <= 0) return null;
  const left = Math.max(0, totalCents - receivedCents);
  return (
    <span className={`erp-chip erp-chip-sm erp-chip-warning ${css.chip}`}
      title={L(`Part payments recorded: ${fmtRM(receivedCents)} received, ${fmtRM(left)} left. Still unpaid until marked paid.`,
        `Bayaran separa direkod: ${fmtRM(receivedCents)} diterima, ${fmtRM(left)} berbaki. Masih belum dibayar sehingga ditanda dibayar.`)}>
      {left === 0 ? L("Parts cover total", "Separa cukup") : `${L("Part paid", "Separa")} · ${fmtRM(left)} ${L("left", "baki")}`}
    </span>
  );
}

export function InvoicePayments({ docId, onChanged }: { docId: number; onChanged?: () => void }) {
  const [data, setData] = useState<PayData | null>(null);
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(mytToday());
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();

  /* a write bumps `tick`; the read happens in the effect, not in a handler */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api<PayData>(`/staff/docs/${docId}/payments`).then((r) => {
      if (!live) return;
      if (r.ok && r.data) { setData(r.data); setFailed(false); } else setFailed(true);
    });
    return () => { live = false; };
  }, [docId, tick]);
  const load = () => setTick((t) => t + 1);

  if (failed) return <span className={css.empty}>{L("Part payments could not be loaded.", "Bayaran separa tidak dapat dimuatkan.")}</span>;
  if (!data) return <SkelRows rows={2} />;

  const paid = data.invoice.payment_status === "paid";
  const live = data.payments.filter((p) => !p.voided_at);
  const last = live.at(-1);

  const record = async () => {
    const rm = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(rm) || rm <= 0) {
      toast(L("No changes", "Tiada perubahan"), L("Enter the amount received.", "Masukkan amaun diterima."), "notice");
      return;
    }
    setBusy(true);
    const r = await api<{ error?: { message?: string }; balance_cents?: number }>(`/staff/docs/${docId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount_cents: Math.round(rm * 100), received_on: on, reference: ref.trim() || undefined }),
    });
    setBusy(false);
    if (!r.ok) {
      toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not recorded - try again", "Tidak direkod - cuba lagi"), "notice");
      return;
    }
    toast(L("Saved", "Disimpan"), L(`Part payment recorded - ${fmtRM(r.data?.balance_cents ?? 0)} left`, `Bayaran separa direkod - baki ${fmtRM(r.data?.balance_cents ?? 0)}`));
    setAmount(""); setRef("");
    load();
    onChanged?.();
  };

  const voidPart = async (p: Part) => {
    const got = await prompt({
      title: L(`Void ${fmtRM(p.amount_cents)} received ${dmy(p.received_on)}?`, `Batalkan ${fmtRM(p.amount_cents)} diterima ${dmy(p.received_on)}?`),
      message: L("The record stays, struck through, with your reason.", "Rekod kekal, dipotong, bersama sebab anda."),
      label: L("Reason", "Sebab"), required: true, confirmLabel: L("Void part payment", "Batalkan bayaran separa"), variant: "danger",
    });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/docs/${docId}/payments/${p.id}/void`, {
      method: "POST", body: JSON.stringify({ reason: got.value }),
    });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not voided", "Tidak dibatalkan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L("Part payment voided", "Bayaran separa dibatalkan"));
    load();
    onChanged?.();
  };

  return (
    <div className={css.stack}>
      {promptNode}{toastNode}
      <div className={css.figures}>
        <span className={css.figure}><span className={css.figureLabel}>{L("Total", "Jumlah")}</span>{fmtRM(data.invoice.total_cents)}</span>
        <span className={css.figure}><span className={css.figureLabel}>{L("Received in parts", "Diterima separa")}</span>{fmtRM(data.received_cents)}</span>
        <span className={css.figure}><span className={css.figureLabel}>{L("Left", "Baki")}</span>{fmtRM(data.balance_cents)}</span>
      </div>
      {data.payments.length === 0 ? (
        <span className={css.empty}>{L("No part payments recorded.", "Tiada bayaran separa direkod.")}</span>
      ) : (
        <ul className={css.list} aria-label={L("Part payments", "Bayaran separa")}>
          {data.payments.map((p) => (
            <li key={p.id} className={`${css.item} ${p.voided_at ? css.voided : ""}`}>
              <span className={css.when}>{dmy(p.received_on)}</span>
              <span className={css.what}>
                <span className={css.whatTitle}>{p.reference || L("Bank transfer", "Pindahan bank")}</span>
                <span className={css.whatDetail}>
                  {p.voided_at
                    ? L(`voided ${dmyMYT(p.voided_at)}${p.voided_by_name ? ` by ${p.voided_by_name}` : ""} - ${p.void_reason ?? ""}`, `dibatalkan ${dmyMYT(p.voided_at)}${p.voided_by_name ? ` oleh ${p.voided_by_name}` : ""} - ${p.void_reason ?? ""}`)
                    : L(`recorded by ${p.recorded_by ?? "-"}`, `direkod oleh ${p.recorded_by ?? "-"}`)}
                </span>
              </span>
              <span className={css.amount}>{fmtRM(p.amount_cents)}</span>
              {!p.voided_at && data.can_record && !paid && (
                <button type="button" className={rowBtn} onClick={() => void voidPart(p)}>{L("Void", "Batal")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!paid && data.balance_cents === 0 && live.length > 0 && last && (
        <p className="erp-note erp-note-success">
          {L(`The parts cover the whole invoice. Mark it paid with the status picker, and pick ${dmy(last.received_on)} - the day the last part was received.`,
            `Bayaran separa meliputi seluruh invois. Tandakan dibayar dengan pemilih status, dan pilih ${dmy(last.received_on)} - hari bahagian terakhir diterima.`)}
        </p>
      )}
      {!paid && data.can_record && data.balance_cents > 0 && !data.pending_migration && (
        <div className={css.form}>
          <label className={css.field}>{L("Amount received (RM)", "Amaun diterima (RM)")}
            <input className={inputClassSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <label className={css.field}>{L("Received on", "Diterima pada")}
            <input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} />
          </label>
          <label className={css.field}>{L("Bank reference (optional)", "Rujukan bank (pilihan)")}
            <input className={inputClassSm} value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} placeholder="MBB241020-8891" />
          </label>
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void record()}>
            {L("Record part payment", "Rekod bayaran separa")}
          </button>
        </div>
      )}
      {!paid && (
        <span className={css.hiddenNote}>
          {L("A part payment does not mark the invoice paid or count in revenue - marking it paid does, as before.",
            "Bayaran separa tidak menanda invois dibayar atau dikira dalam hasil - menanda dibayar yang berbuat demikian, seperti sebelum ini.")}
        </span>
      )}
    </div>
  );
}
