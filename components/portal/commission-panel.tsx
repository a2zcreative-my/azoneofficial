"use client";

/* v1.224.0 - THE COMMISSION TAB, back (the owner's Commission brief and
   answers, 29-10-2026; claude/COMMISSION-AUDIT.md). Three views, never one
   page: Entries (what each sale earned, or may), Flow (where every invoice
   and entitlement stands, the seven stages) and Policy (the versioned rule,
   its approval and the payroll switch). Every figure comes from
   /staff/commission/* (worker/src/commission.ts) - nothing is calculated,
   invented or paid from here. A consultant sees their own entries only; the
   CCO reads everything and changes nothing.

   v1.227.0 - the owner's Commission Configuration brief and answers
   (30-10-2026, claude/COMMISSION-CONFIG-AUDIT.md: "Commission page like
   reference"): five views - Overview (the figures, the flow, what must be
   true before commission is paid), Transactions (the entries), Policy
   Settings (the version in force, its package rules, drafting and
   approval), Payroll Sync (the switch and the cutoff) and Audit History
   (every decision). Same engine, same data; the Sales page is untouched.

   v1.232.0 - Commission 2.1 (claude/COMMISSION-2.1-AUDIT.md): every open
   invoice and entitlement names its next step and who takes it (NEXT); the
   Overview shows invoices and entitlements as two rows never added
   together; an estimate opens line by line; a leaver's commission can be
   recorded as settled; versions show their lifecycle; rules may name a
   library package; product lines earn only when listed. */

import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows, SkelStat } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { ScopeSwitch, type WsScope } from "@/components/portal/sales-workspace";
import { makeApi, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import type { Policy, Summary } from "@/components/portal/commission-card";
import css from "./commission.module.css";
import { AgentDeals } from "./agent-deals";
import { AgentsHead5, Overview5, PayrollSync5, PolicyHead5, Transactions5, isCommissionView, monthWord, monthsFrom, type CommissionView, type Company, type TxRow } from "./commission5"; // v1.311.0 - Commission Workspace 5.0
import c5 from "./commission5.module.css"; // v1.311.0
import { ViewSwitch } from "@/components/portal/executive-cards"; // v1.311.0 - the phone view switch
import { useTabViewAddress } from "@/lib/tab-view"; // v1.311.0 - the view in the address

const api = makeApi("/staff/commission");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
const VIEW_ALL = ["super_admin", "admin", "ceo", "coo", "cco"];
const ym = (m: string | null | undefined) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString(getLang() === "ms" ? "ms-MY" : "en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "—");

interface Entry {
  id: number; kind: "earn" | "reverse"; invoice_id: number; doc_number: string; company: string | null; package: string; closer_name: string | null; user_id: number | null;
  invoice_total: number; payment_status: string | null; rate_bp: number | null; fixed_cents: number | null; policy_version: number | null;
  amount_cents: number; basis_cents: number; status: "eligible" | "review" | "included" | "paid" | "void"; eligible_at: string; payroll_month: string | null;
  paid_out_at: string | null; note: string | null; confirmed_at: string | null; confirmed_by_name: string | null; decision_note: string | null;
  issuer_code?: string | null; next?: string;
  /* v1.255.0 - agent partnership: whose row it is, the deal, a held sale */
  recipient_role?: "closer" | "agent"; deal?: "direct" | "partnership" | "review" | null; hold?: number; agent_name?: string | null;
}
interface Estimate {
  invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; user_id: number | null; invoice_total: number; payment_status: string | null;
  received_cents: number; stage: "unpaid" | "part_paid" | "awaiting_confirmation"; package: string; created_at: string;
  estimate_cents: number | null; basis_cents: number | null; policy_version: number | null;
  issuer_code?: string | null; next?: string;
  deal?: "direct" | "partnership" | "review"; closer_rate_bp?: number | null; agent_estimate_cents?: number | null;
}
type LineRule = "percent" | "fixed" | "none" | "default" | "not_listed";
interface LineCalc { name: string; qty: number; basis_cents: number; package: string | null; rule: LineRule; rate_bp: number | null; fixed_cents: number | null; amount_cents: number }
interface InvoiceResp {
  invoice: { id: number; doc_number: string; company: string | null; closer_name: string | null; total_cents: number | null; payment_status: string | null; received_cents: number; issuer_code: string | null; doc_kind: string | null; package_id: number | null; created_at: string };
  stage: Estimate["stage"]; next: string; policy: (Policy & { product_rule?: string }) | null; basis_cents: number | null; estimate_cents: number | null; lines: LineCalc[] | null;
}

/* v1.232.0 (Commission 2.1, audit C6/C7) - THE NEXT STEP, AND WHO TAKES IT.
   The worker returns a key for every open invoice and every entitlement;
   this is the only place it is worded. Only the step itself is named -
   never a button the reader may not press. */
const NEXT: Record<string, [string, string, string, string]> = {
  choose_closer: ["Name the closer on the invoice", "Namakan penutup pada invois", "Sales · CEO", "Jualan · CEO"],
  approve_policy: ["Approve a policy version", "Luluskan versi polisi", "CEO", "CEO"],
  await_payment: ["Collect the payment", "Kutip bayaran", "Sales", "Jualan"],
  await_balance: ["Collect the balance", "Kutip baki", "Sales", "Jualan"],
  confirm_paid: ["Confirm Paid (Sales -> Closed Sales)", "Sahkan Dibayar (Jualan -> Jualan Ditutup)", "CEO", "CEO"], // v1.311.0 (K-3) - the CEO owner alone
  ceo_decides: ["Decide the review", "Putuskan semakan", "CEO", "CEO"],
  payroll_off: ["Waits for the payroll switch", "Menunggu suis gaji", "CEO", "CEO"],
  next_payroll: ["Goes into the next open payroll", "Masuk gaji terbuka seterusnya", "Payroll (automatic)", "Gaji (automatik)"],
  recompute_payroll: ["Recompute the month - not on the payslip yet", "Kira semula bulan - belum dalam slip gaji", "Payroll (HR)", "Gaji (HR)"],
  await_bank_run: ["Record the bank run as done", "Rekod pembayaran bank selesai", "Finance", "Kewangan"],
  settle_leaver: ["Settle in the final settlement", "Selesaikan dalam penyelesaian akhir", "CEO", "CEO"],
  decide_attribution: ["Decide the attribution (agent deal or not)", "Putuskan atribusi (urusan ejen atau tidak)", "CEO", "CEO"],
  attribution_hold: ["On hold: attribution review once paid", "Ditahan: semakan atribusi selepas dibayar", "CEO", "CEO"],
  authorise_payout: ["Authorise the agent payout", "Benarkan bayaran ejen", "CEO", "CEO"],
  confirm_settlement: ["Confirm the bank settlement", "Sahkan penyelesaian bank", "Finance (COO)", "Kewangan (COO)"], // v1.311.0 (K-5)
  done: ["Nothing - paid", "Tiada - dibayar", "", ""],
  none: ["Nothing - closed", "Tiada - ditutup", "", ""],
};
const nextText = (k: string | undefined) => { const t = k ? NEXT[k] : undefined; return !t ? "—" : t[2] ? `${L(t[0], t[1])} · ${L(t[2], t[3])}` : L(t[0], t[1]); };
const lineRuleText = (b: { rule: LineRule; rate_bp: number | null; fixed_cents: number | null }) => b.rule === "none" ? L("No commission", "Tiada komisen")
  : b.rule === "not_listed" ? L("Product not listed - earns nothing", "Produk tidak disenaraikan - tiada komisen")
  : b.rule === "fixed" ? L(`${fmtRM(b.fixed_cents ?? 0)} per unit`, `${fmtRM(b.fixed_cents ?? 0)} seunit`) : b.rule === "percent" ? `${((b.rate_bp ?? 0) / 100).toFixed(2)}%`
  : L(`Default · ${b.rate_bp !== null ? `${(b.rate_bp / 100).toFixed(2)}%` : fmtRM(b.fixed_cents ?? 0)}`, `Asas · ${b.rate_bp !== null ? `${(b.rate_bp / 100).toFixed(2)}%` : fmtRM(b.fixed_cents ?? 0)}`);
function LinesTable({ lines }: { lines: LineCalc[] }) {
  return (
    <div className={css.tableWrap}>
      <table className={css.table} aria-label={L("Calculation by line", "Pengiraan mengikut baris")}>
        <thead><tr><th>{L("Line", "Baris")}</th><th className={css.num}>{L("Basis", "Asas")}</th><th>{L("Rule", "Peraturan")}</th><th className={css.num}>{L("Commission", "Komisen")}</th></tr></thead>
        <tbody>{lines.map((b, i) => (
          <tr key={i}><td className={css.wrapCell}>{b.name}{b.qty !== 1 ? ` × ${b.qty}` : ""}</td><td className={css.num}>{fmtRM(b.basis_cents)}</td>
            <td>{lineRuleText(b)}{b.package ? ` · ${b.package}` : ""}</td>
            <td className={css.num}>{fmtRM(b.amount_cents)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export const rateText = (p: { rate_kind?: string; rate_bp: number | null; fixed_cents: number | null } | null) =>
  !p ? "—" : p.fixed_cents !== null && p.rate_bp === null ? fmtRM(p.fixed_cents) : `${((p.rate_bp ?? 0) / 100).toFixed(2)}%`;
export const basisText = (b: string | undefined) => b === "invoice_total"
  ? L("The invoice total as charged (with SST and delivery)", "Jumlah invois seperti dicaj (dengan SST dan penghantaran)")
  : L("The sale after discounts, excluding SST and delivery", "Jualan selepas diskaun, tidak termasuk SST dan penghantaran");
const STATUS: Record<Entry["status"], [string, string, string]> = {
  eligible: ["Eligible", "Layak", chipSuccess], review: ["Under review", "Dalam semakan", chipWarn],
  included: ["In payroll", "Dalam gaji", chipInfo], paid: ["Paid", "Dibayar", chipSuccess], void: ["Void", "Batal", chipNeutral],
};
const statusChip = (e: Entry) => e.hold && e.status === "review"
  ? <span className={chipWarn}>{L("On hold: attribution review", "Ditahan: semakan atribusi")}</span>
  : <span className={STATUS[e.status][2]}>{L(STATUS[e.status][0], STATUS[e.status][1])}{e.status === "included" ? (e.recipient_role === "agent" ? ` · ${L("payout", "bayaran")}` : ` · ${ym(e.payroll_month)}`) : ""}</span>;
/* v1.255.0 - each reader is told their OWN rate ("Your commission rate: 3%");
   management sees whose row it is and the deal */
const pctOf = (bp: number | null | undefined) => `${((bp ?? 0) / 100).toFixed((bp ?? 0) % 100 ? 2 : 0)}%`;
export const dealWord = (c: string, decision?: string | null) => decision === "partnership" ? L("Agent partnership (decided)", "Perkongsian ejen (diputuskan)")
  : decision === "direct" ? L("Direct sale (decided)", "Jualan langsung (diputuskan)") : decision === "none" ? L("No commission (decided)", "Tiada komisen (diputuskan)")
  : c === "partnership" ? L("Agent partnership", "Perkongsian ejen") : c === "review" ? L("Held: attribution review", "Ditahan: semakan atribusi") : L("Direct sale", "Jualan langsung");
const payWord = (s: string | null) => s === "paid" ? L("Paid in full", "Dibayar penuh") : s === "overdue" ? L("Overdue", "Tertunggak") : L("Unpaid", "Belum dibayar");

type View = "overview" | "transactions" | "agents" | "policy" | "payroll" | "audit";

/* ------------------------------------------------------------------ */
/* One entry: every fact, every step, the review                        */
function EntryDrawer({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ id: number; d: { entry: Entry & { tax_percent: number; discount_cents: number; delivery_cents: number; policy_name: string | null; policy_basis: string | null }; related: { id: number; kind: string; status: string; amount_cents: number; payroll_month: string | null; note: string | null; created_at: string }[]; confirmations: { id: number; amount_cents: number; payment_ref: string | null; confirmed_at: string; confirmed_by_name: string | null; revoked_at: string | null; revoke_reason: string | null; revoked_by_name: string | null }[]; history: { action: string; detail: string | null; created_at: string; who: string | null }[]; breakdown?: LineCalc[] | null; can_decide: boolean; attribution?: { classification: string; agent_name: string | null; decision: string | null } | null } | null; e: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    if (id === null) return;
    const c = new AbortController();
    void api<NonNullable<typeof got>["d"]>(`/entries/${id}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ id, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [id, tick]);
  const mine = got?.id === id ? got : null;
  const d = mine?.d;
  const e = d?.entry;
  const decide = async (decision: "apply" | "dismiss" | "settled" | "settle") => {
    if (!e) return;
    setBusy(true); setError("");
    const r = await api<{ status: string }>(`/ledger/${e.id}/decide`, { method: "POST", body: JSON.stringify({ decision, note }) });
    setBusy(false);
    if (r.ok) { toast(L("Decision recorded", "Keputusan direkod"), decision === "apply" ? L("Applied", "Dilaksanakan") : decision === "settle" ? L("Recorded as paid in the final settlement", "Direkod dibayar dalam penyelesaian akhir") : L("Closed, with your reason", "Ditutup, dengan sebab anda")); setNote(""); setTick((t) => t + 1); onSaved(); }
    else setError(message(r));
  };
  return (
    <SideDrawer open={id !== null} onClose={onClose} wide title={e ? `${e.doc_number} · ${e.kind === "earn" ? L("Commission", "Komisen") : L("Reversal", "Pembalikan")}` : L("Commission entry", "Entri komisen")} subtitle={e ? `${e.company ?? "—"} · ${e.closer_name ?? L("No closer", "Tiada penutup")}` : undefined}>
      {toastNode}
      {mine?.e ? <p role="alert" className={css.error}>{mine.e}</p> : !e || !d ? <SkelRows rows={8} /> : (
        <div className={css.body}>
          <dl className={css.dl}>
            <dt>{L("Invoice", "Invois")}</dt><dd>{e.doc_number} · {fmtRM(e.invoice_total)} · {payWord(e.payment_status)}</dd>
            <dt>{L("Customer", "Pelanggan")}</dt><dd>{e.company ?? "—"}</dd>
            <dt>{L("Package or service", "Pakej atau servis")}</dt><dd>{e.package || "—"}</dd>
            <dt>{L("Verified closer", "Penutup disahkan")}</dt><dd>{e.closer_name ?? L("None yet", "Belum ada")}</dd>
            <dt>{L("Basis", "Asas")}</dt><dd>{fmtRM(e.basis_cents)}{e.kind === "earn" ? ` · ${basisText(e.policy_basis ?? undefined)}` : ""}</dd>
            <dt>{L("Rate · policy", "Kadar · polisi")}</dt><dd>{e.kind === "earn" ? `${e.rate_bp !== null ? pctOf(e.rate_bp) : rateText(e)} · v${e.policy_version ?? "—"} ${e.policy_name ?? ""}` : `v${e.policy_version ?? "—"}`}</dd>
            {d.attribution && <><dt>{L("Sale type", "Jenis jualan")}</dt><dd>{dealWord(d.attribution.classification, d.attribution.decision)}{d.attribution.agent_name ? ` · ${L("agent", "ejen")} ${d.attribution.agent_name}` : ""}{e.recipient_role === "agent" ? ` · ${L("this is the agent's row", "ini baris ejen")}` : ""}</dd></>}
            <dt>{L("Commission", "Komisen")}</dt><dd><strong>{fmtRM(e.amount_cents)}</strong> {statusChip(e)}</dd>
            <dt>{L("Eligible from", "Layak dari")}</dt><dd>{dmyMYT(e.eligible_at)}</dd>
            <dt>{L("Payroll", "Gaji")}</dt><dd>{e.payroll_month ? ym(e.payroll_month) : L("Not yet in a payroll month", "Belum dalam bulan gaji")}</dd>
            <dt>{L("Paid out", "Dibayar")}</dt><dd>{e.paid_out_at ? dmyMYT(e.paid_out_at) : L("Not yet", "Belum")}</dd>
            <dt>{L("Issued by", "Dikeluarkan oleh")}</dt><dd>{e.issuer_code ?? "—"}</dd>
            <dt>{L("Next step", "Langkah seterusnya")}</dt><dd>{nextText(e.next)}</dd>
          </dl>
          {/* v1.227.0 - the line-by-line working when the version has package rules */}
          {d.breakdown && d.breakdown.length > 0 && (
            <div>
              <p className={css.groupLabel}>{L("How it was calculated", "Cara ia dikira")}</p>
              <LinesTable lines={d.breakdown} />
            </div>
          )}
          {e.note && <p className={`${css.note} ${e.status === "review" ? css.warnNote : ""}`}>{e.note}</p>}
          {e.decision_note && <p className={css.note}>{L("Decision", "Keputusan")}: {e.decision_note}</p>}
          {e.hold ? <p className={`${css.note} ${css.warnNote}`}>{L("This sale is held for attribution review. Nothing is payable until the CEO decides it under Agent deals: an agent partnership (agent + closer rates), a direct sale, or no commission.", "Jualan ini ditahan untuk semakan atribusi. Tiada apa boleh dibayar sehingga CEO memutuskannya di Urusan Ejen: perkongsian ejen, jualan langsung, atau tiada komisen.")}</p> : null}
          {d.can_decide && e.status === "review" && !e.hold && (
            <fieldset className={css.form} disabled={busy}>
              <p className={css.groupLabel}>{L("Decide this review", "Putuskan semakan ini")}</p>
              <label>{L("Reason", "Sebab")}<textarea aria-label={L("Decision reason", "Sebab keputusan")} className={inputClass} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} /></label>
              <div className={css.formRow}>
                <button type="button" className={btnClass} disabled={note.trim().length < 10} onClick={() => void decide("apply")}><AppIcon name="success" />{e.kind === "earn" ? L("Apply to the closer", "Laksana kepada penutup") : L("Apply before payroll", "Laksana sebelum gaji")}</button>
                {e.kind === "reverse" && <button type="button" className={btnSm} disabled={note.trim().length < 10} onClick={() => void decide("settled")}>{L("Settled outside payroll", "Diselesaikan di luar gaji")}</button>}
                <button type="button" className={btnSm} disabled={note.trim().length < 10} onClick={() => void decide("dismiss")}>{L("Dismiss", "Tolak")}</button>
              </div>
              <p className={css.sub}>{L("Commission already paid out is never deducted from wages here. Any recovery is a separate, authorised HR step.", "Komisen yang sudah dibayar tidak sekali-kali dipotong daripada gaji di sini. Sebarang pemulihan ialah langkah HR berasingan yang dibenarkan.")}</p>
              {error && <p role="alert" className={css.error}>{error}</p>}
            </fieldset>
          )}
          {/* v1.232.0 (audit F6) - the leaver rule's "or settle": eligible
              commission of someone no longer on payroll, recorded as paid in
              the final settlement. Never voided, never deducted. */}
          {d.can_decide && e.next === "settle_leaver" && (
            <fieldset className={css.form} disabled={busy}>
              <p className={css.groupLabel}>{L("Final settlement", "Penyelesaian akhir")}</p>
              <p className={css.sub}>{L("This person has left, so no payroll month will take this commission. Record it once it is paid in the final settlement (or otherwise outside payroll).", "Individu ini telah berhenti, jadi tiada bulan gaji akan mengambil komisen ini. Rekodkannya apabila dibayar dalam penyelesaian akhir (atau di luar gaji).")}</p>
              <label>{L("Reason and reference", "Sebab dan rujukan")}<textarea aria-label={L("Settlement reason", "Sebab penyelesaian")} className={inputClass} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} /></label>
              <div className={css.formRow}>
                <button type="button" className={btnClass} disabled={note.trim().length < 10} onClick={() => void decide("settle")}><AppIcon name="success" />{L("Record as settled", "Rekod sebagai diselesaikan")}</button>
              </div>
              {error && <p role="alert" className={css.error}>{error}</p>}
            </fieldset>
          )}
          <div>
            <p className={css.groupLabel}>{L("Payment confirmation", "Pengesahan bayaran")}</p>
            {d.confirmations.length === 0 ? <p className={css.empty}>{L("None.", "Tiada.")}</p> : (
              <ul className={css.list}>{d.confirmations.map((c) => (
                <li key={c.id}><span className={css.listMain}><strong>{fmtRM(c.amount_cents)} · {c.confirmed_by_name ?? "—"}</strong><span>{dmyMYT(c.confirmed_at)}{c.payment_ref ? ` · ${c.payment_ref}` : ""}</span></span>
                  {c.revoked_at ? <span className={chipWarn}>{L("Taken back", "Ditarik balik")} · {c.revoke_reason}</span> : <span className={chipSuccess}>{L("Confirmed", "Disahkan")}</span>}</li>
              ))}</ul>
            )}
          </div>
          <div>
            <p className={css.groupLabel}>{L("Entries on this invoice", "Entri pada invois ini")}</p>
            <ul className={css.list}>{d.related.map((r) => (
              <li key={r.id}><span className={css.listMain}><strong>{r.kind === "earn" ? L("Earned", "Diperoleh") : L("Reversal", "Pembalikan")} · {fmtRM(r.amount_cents)}</strong><span>{dmyMYT(r.created_at)}{r.payroll_month ? ` · ${ym(r.payroll_month)}` : ""}{r.note ? ` · ${r.note}` : ""}</span></span>
                <span className={STATUS[r.status as Entry["status"]]?.[2] ?? chipNeutral}>{L(STATUS[r.status as Entry["status"]]?.[0] ?? r.status, STATUS[r.status as Entry["status"]]?.[1] ?? r.status)}</span></li>
            ))}</ul>
          </div>
          <div>
            <p className={css.groupLabel}>{L("Audit history", "Sejarah audit")}</p>
            {d.history.length === 0 ? <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
              <ul className={css.list}>{d.history.map((h, i) => (
                <li key={i}><span className={css.listMain}><strong>{h.action}</strong><span>{h.who ?? "—"} · {dmyMYT(h.created_at)}</span></span></li>
              ))}</ul>
            )}
          </div>
        </div>
      )}
    </SideDrawer>
  );
}

/* ------------------------------------------------------------------ */
/* One open invoice (v1.232.0, audit C7): the estimate line by line     */
/* under the version that would apply, and what it is waiting for       */
function EstimateDrawer({ est, onClose }: { est: Estimate | null; onClose: () => void }) {
  const id = est?.invoice_id ?? null;
  const [got, setGot] = useState<{ id: number; d: InvoiceResp | null; e: string } | null>(null);
  useEffect(() => {
    if (id === null) return;
    const c = new AbortController();
    void api<InvoiceResp>(`/invoice/${id}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ id, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [id]);
  const mine = got?.id === id ? got : null;
  const d = mine?.d ?? null;
  const stage = d?.stage ?? est?.stage;
  return (
    <SideDrawer open={est !== null} onClose={onClose} wide title={est ? `${est.doc_number} · ${L("Estimate", "Anggaran")}` : ""} subtitle={est ? `${est.company ?? "—"} · ${est.closer_name ?? L("No closer", "Tiada penutup")}` : undefined}>
      {est && (
        <div className={css.body}>
          <dl className={css.dl}>
            <dt>{L("Invoice", "Invois")}</dt><dd>{est.doc_number} · {fmtRM(est.invoice_total)}{est.issuer_code ? ` · ${est.issuer_code}` : ""}</dd>
            <dt>{L("Package or service", "Pakej atau servis")}</dt><dd>{est.package || "—"}</dd>
            <dt>{L("Payment", "Bayaran")}</dt><dd>{stage === "part_paid" ? L(`Part paid · ${fmtRM(d?.invoice.received_cents ?? est.received_cents)} received`, `Dibayar sebahagian · ${fmtRM(d?.invoice.received_cents ?? est.received_cents)} diterima`) : payWord(d?.invoice.payment_status ?? est.payment_status)}</dd>
            <dt>{L("Policy that would apply", "Polisi yang akan terpakai")}</dt><dd>{d ? (d.policy ? `v${d.policy.version} · ${rateText(d.policy)} · ${basisText(d.policy.basis)}` : L("No approved policy", "Tiada polisi diluluskan")) : est.policy_version ? `v${est.policy_version}` : "—"}</dd>
            <dt>{L("Basis", "Asas")}</dt><dd>{(d?.basis_cents ?? est.basis_cents) === null ? "—" : fmtRM((d?.basis_cents ?? est.basis_cents)!)}</dd>
            <dt>{L("Estimated commission", "Anggaran komisen")}</dt><dd><strong>{(d?.estimate_cents ?? est.estimate_cents) === null ? L("No approved policy", "Tiada polisi diluluskan") : fmtRM((d?.estimate_cents ?? est.estimate_cents)!)}</strong> <span className={chipNeutral}>{L("Not earned", "Belum diperoleh")}</span></dd>
            <dt>{L("Next step", "Langkah seterusnya")}</dt><dd>{nextText(d?.next ?? est.next)}</dd>
          </dl>
          {mine?.e ? <p role="alert" className={css.error}>{mine.e}</p> : !d ? <SkelRows rows={3} /> : d.lines && d.lines.length > 0 ? (
            <div>
              <p className={css.groupLabel}>{L("How it would be calculated", "Cara ia akan dikira")}</p>
              <LinesTable lines={d.lines} />
            </div>
          ) : null}
          <p className={css.note}>{stage === "awaiting_confirmation"
            ? L("Paid in full. It becomes eligible when the CEO confirms the payment on Sales -> Closed Sales.", "Dibayar penuh. Ia menjadi layak apabila CEO mengesahkan bayaran di Jualan -> Jualan Ditutup.")
            : L("An estimate only - it earns nothing until the whole invoice is paid and the CEO confirms it. A part payment never earns on its own.", "Anggaran sahaja - tiada apa diperoleh sehingga keseluruhan invois dibayar dan disahkan CEO atau COO. Bayaran sebahagian tidak memperoleh apa-apa.")}</p>
        </div>
      )}
    </SideDrawer>
  );
}

interface FlowRow { key: string; n: number; cents: number; next: string }
interface FlowResp {
  start: string; sync: boolean; policy: Policy | null;
  invoices: FlowRow[]; entitlements: FlowRow[]; confirmed_total: { n: number; cents: number };
  exceptions: { review: { n: number; cents: number }; no_policy: number; no_closer: number; awaiting_confirmation: number; carried_forward: { n: number; cents: number }; leavers: { n: number; cents: number }; not_on_payslip?: { n: number; cents: number } };
}
/* v1.232.0 (audit F7/C6) - TWO ROWS, NEVER ADDED TOGETHER: open invoices
   by their one current stage (valued at the invoice total), and
   entitlements by their one status (valued at the commission). */
/* ------------------------------------------------------------------ */
/* Policy                                                               */
interface PkgRule { package_name: string; match_key: string; rule: "percent" | "fixed" | "none"; rate_bp: number | null; fixed_cents: number | null }
type PolicyP = Policy & { packages?: PkgRule[]; product_rule?: string | null; agent_rate_bp?: number | null; agent_closer_rate_bp?: number | null; agent_renewal_rule?: string | null; agent_mismatch_reason?: string | null };
/* v1.255.0 - "Direct 10% · Agent deals: agent 7% + closer 3% = 10%" */
const agentTerms = (p: PolicyP) => p.agent_rate_bp == null || p.agent_closer_rate_bp == null ? null
  : L(`Direct ${p.rate_kind === "percent" ? pctOf(p.rate_bp) : rateText(p)} · Agent deals: agent ${pctOf(p.agent_rate_bp)} + closer ${pctOf(p.agent_closer_rate_bp)} = ${pctOf(p.agent_rate_bp + p.agent_closer_rate_bp)}`,
    `Langsung ${p.rate_kind === "percent" ? pctOf(p.rate_bp) : rateText(p)} · Urusan ejen: ejen ${pctOf(p.agent_rate_bp)} + penutup ${pctOf(p.agent_closer_rate_bp)} = ${pctOf(p.agent_rate_bp + p.agent_closer_rate_bp)}`);
const agentMismatch = (p: PolicyP) => p.agent_rate_bp != null && p.agent_closer_rate_bp != null && (p.rate_kind !== "percent" || p.agent_rate_bp + p.agent_closer_rate_bp !== p.rate_bp);
interface Suggest { from_invoices: { name: string; n: number; last_price_cents: number | null; last_on: string }[]; rate_card: string[]; library?: { id: number; name: string; status: string; current_version: number }[] }
/* v1.232.0 - a rule naming a library package covers every line of an invoice made from it */
const libId = (r: { match_key: string }) => r.match_key.startsWith("pkg:") ? Number(r.match_key.slice(4)) || null : null;
const pkgLabel = (r: PkgRule) => libId(r) ? L(`${r.package_name} (library package)`, `${r.package_name} (pakej pustaka)`) : r.package_name;
const keyOf = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
const pkgRuleText = (r: Pick<PkgRule, "rule" | "rate_bp" | "fixed_cents">) => r.rule === "none" ? L("No commission", "Tiada komisen") : r.rule === "fixed" ? L(`${fmtRM(r.fixed_cents ?? 0)} per unit`, `${fmtRM(r.fixed_cents ?? 0)} seunit`) : `${((r.rate_bp ?? 0) / 100).toFixed(2)}%`;
const pkgOn = (r: PkgRule | null, p: Policy, price: number) => r ? (r.rule === "none" ? 0 : r.rule === "fixed" ? (r.fixed_cents ?? 0) : Math.floor((price * (r.rate_bp ?? 0) + 5000) / 10000))
  : p.rate_kind === "fixed" ? (p.fixed_cents ?? 0) : Math.floor((price * (p.rate_bp ?? 0) + 5000) / 10000);
interface PolicyResp { versions: PolicyP[]; log: { setting: string; value: string; reason: string; changed_at: string; changed_by_name: string | null }[]; in_force: PolicyP | null; sync: boolean; start: string; today: string; can_draft: boolean; can_approve: boolean; can_switch: boolean; agent_partnership?: string; pending_migration?: boolean }
interface PreviewResp { policy: Policy; rows: { invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; package: string; paid_day: string; basis_cents: number; amount_cents: number; current_version: number | null; current_cents: number | null }[]; total_cents: number }
/* v1.232.0 (audit C8) - a version's place in its life: drafted, approved
   for a later day, in force today, or superseded by a later version */
const lifecycle = (v: Policy, inForce: Policy | null, today: string): [string, string] =>
  v.status === "draft" ? [L("Draft · awaiting CEO", "Draf · menunggu CEO"), chipWarn]
    : v.status === "rejected" ? [L("Rejected", "Ditolak"), chipNeutral]
    : v.status !== "active" ? [v.status, chipNeutral]
    : inForce?.id === v.id ? [L("In force", "Berkuat kuasa"), chipSuccess]
    : v.effective_from > today ? [L(`Approved · starts ${dmy(v.effective_from)}`, `Diluluskan · bermula ${dmy(v.effective_from)}`), chipInfo]
    : [L("Superseded", "Digantikan"), chipNeutral];
function usePolicy(revision: number, tick: number) {
  const [got, setGot] = useState<{ k: string; d: PolicyResp | null; e: string } | null>(null);
  const key = `${revision}|${tick}`;
  useEffect(() => {
    const c = new AbortController();
    void api<PolicyResp>(`/policy`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ k: key, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [key]);
  return { d: got?.k === key ? got.d : got?.d ?? null, e: got?.e ?? "" };
}

type PkgForm = { name: string; rule: "percent" | "fixed" | "none"; value: string; pkgId: number | null };
function PolicyView({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const { d, e: loadErr } = usePolicy(revision, tick);
  const [form, setForm] = useState<{ name: string; from: string; kind: "percent" | "fixed"; rate: string; fixed: string; basis: "net_of_tax_delivery" | "invoice_total"; reason: string; packages: PkgForm[]; agentOn: boolean; agentRate: string; closerRate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: number; d: PreviewResp | null; e: string } | null>(null);
  const [sug, setSug] = useState<Suggest | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt: ask, node: askNode } = usePrompt();
  useEffect(() => {
    const c = new AbortController();
    void api<Suggest>(`/packages`, { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setSug(r.data); });
    return () => c.abort();
  }, [revision]);
  const done = (t: string, sub: string) => { toast(t, sub); setTick((x) => x + 1); onChanged(); };
  const saveDraft = async () => {
    if (!form) return;
    setBusy(true); setError("");
    const packages = form.packages.filter((x) => x.pkgId || x.name.trim()).map((x) => ({ name: x.name.trim(), ...(x.pkgId ? { package_id: x.pkgId } : {}), rule: x.rule, ...(x.rule === "percent" ? { rate_pct: Number(x.value) } : x.rule === "fixed" ? { fixed_cents: Math.round(Number(x.value) * 100) } : {}) }));
    const r = await api<{ version: number }>(`/policy`, { method: "POST", body: JSON.stringify({ name: form.name, effective_from: form.from, rate_kind: form.kind, rate_pct: Number(form.rate), fixed_cents: Math.round(Number(form.fixed) * 100), basis: form.basis, reason: form.reason, packages, ...(form.agentOn && form.kind === "percent" ? { agent_rate_pct: Number(form.agentRate), agent_closer_rate_pct: Number(form.closerRate), agent_renewal_rule: "review" } : {}) }) });
    setBusy(false);
    if (r.ok) { setForm(null); done(L("Draft saved", "Draf disimpan"), r.data?.version ? L(`Version ${r.data.version} waits for the CEO's approval`, `Versi ${r.data.version} menunggu kelulusan CEO`) : L("It waits for the CEO's approval", "Ia menunggu kelulusan CEO")); } else setError(message(r));
  };
  const approve = async (p: PolicyP) => {
    const pk = p.packages?.length ? `\n${L("Package rules", "Peraturan pakej")}: ${p.packages.map((x) => `${pkgLabel(x)} ${pkgRuleText(x)}`).join(" · ")}` : "";
    const at = agentTerms(p);
    if (!(await confirm({ title: L(`Approve version ${p.version}?`, `Luluskan versi ${p.version}?`), message: `${p.name}\n${at ?? rateText(p)} · ${basisText(p.basis)}${pk}\n${L("From", "Mulai")} ${dmy(p.effective_from)}`, confirmLabel: L("Approve policy", "Luluskan polisi") }))) return;
    let mismatch_reason: string | undefined;
    if (agentMismatch(p)) {
      const got = await ask({ title: L("The agent rates do not add up to the direct rate", "Kadar ejen tidak sama dengan kadar langsung"), label: L(`${at}. Why approve it anyway? (at least 10 characters)`, `${at}. Mengapa luluskan juga? (sekurang-kurangnya 10 aksara)`), required: true, confirmLabel: L("Approve with this reason", "Luluskan dengan sebab ini") });
      mismatch_reason = got?.value?.trim() ?? "";
      if (!mismatch_reason) return;
    }
    const r = await api(`/policy/${p.id}/approve`, { method: "POST", body: JSON.stringify({ confirm: true, ...(mismatch_reason ? { mismatch_reason } : {}) }) });
    if (r.ok) done(L("Policy approved", "Polisi diluluskan"), L(`Version ${p.version} applies from ${dmy(p.effective_from)}`, `Versi ${p.version} terpakai mulai ${dmy(p.effective_from)}`)); else setError(message(r));
  };
  const reject = async (p: Policy) => {
    const got = await ask({ title: L(`Reject version ${p.version}?`, `Tolak versi ${p.version}?`), label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Reject draft", "Tolak draf") });
    const reason = got?.value?.trim() ?? "";
    if (!reason) return;
    const r = await api(`/policy/${p.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    if (r.ok) done(L("Draft rejected", "Draf ditolak"), L("Kept in the history", "Disimpan dalam sejarah")); else setError(message(r));
  };
  const openPreview = (p: Policy) => {
    setPreview({ id: p.id, d: null, e: "" });
    void api<PreviewResp>(`/policy/${p.id}/preview`).then((r) => setPreview({ id: p.id, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }));
  };
  const p = d?.in_force ?? null;
  const floor = d ? (d.today > d.start ? d.today : d.start) : mytToday();
  const priceOf = (name: string) => sug?.from_invoices.find((x) => keyOf(x.name) === keyOf(name))?.last_price_cents ?? null;
  /* the example table: the version's package rules, or - with none - the
     lines most used on recent invoices, each at its real latest price */
  const examples: { name: string; rule: PkgRule | null; price: number | null }[] = p
    ? (p.packages?.length ? p.packages.map((r) => ({ name: r.package_name, rule: r, price: priceOf(r.package_name) }))
      : (sug?.from_invoices ?? []).filter((x) => x.last_price_cents !== null).slice(0, 5).map((x) => ({ name: x.name, rule: null, price: x.last_price_cents })))
    : [];
  /* v1.311.0 - one way to start a draft: the Versions button and the
     Commission Structure's New Version (an approved version is never edited) */
  const startDraft = () => { if (!d?.can_draft) return; setForm({ name: p ? `${p.name}` : L("A2Z Sales Commission", "Komisen Jualan A2Z"), from: floor, kind: p?.rate_kind ?? "percent", rate: p?.rate_bp ? String(p.rate_bp / 100) : "", fixed: p?.fixed_cents ? String(p.fixed_cents / 100) : "", basis: p?.basis ?? "net_of_tax_delivery", reason: "", packages: (p?.packages ?? []).map((x) => ({ name: x.package_name, pkgId: libId(x), rule: x.rule, value: x.rule === "percent" ? String((x.rate_bp ?? 0) / 100) : x.rule === "fixed" ? String((x.fixed_cents ?? 0) / 100) : "" })), agentOn: p?.agent_rate_bp != null, agentRate: p?.agent_rate_bp != null ? String(p.agent_rate_bp / 100) : "7", closerRate: p?.agent_closer_rate_bp != null ? String(p.agent_closer_rate_bp / 100) : "3" }); requestAnimationFrame(() => document.getElementById("commission-versions")?.scrollIntoView({ block: "start" })); };
  const pkgValid = (x: PkgForm) => (!x.pkgId && !x.name.trim()) || x.rule === "none" || (x.rule === "percent" ? Number(x.value) >= 0 && Number(x.value) <= 50 && x.value !== "" : Number(x.value) > 0);
  return (
    <>
      {toastNode}{confirmNode}{askNode}
      {loadErr ? <p role="alert" className={css.error}>{loadErr}</p> : null}
      {/* v1.311.0 (ref 4) - the structure in force and the rules that hold it */}
      {!d ? <SkelRows rows={4} /> : <PolicyHead5 inForce={p} canDraft={d.can_draft} hold={d.agent_partnership === "off"} onNewVersion={startDraft} />}
      <TabZone label={L("Policy in force", "Polisi berkuat kuasa")} cols={2}>
        <div className={card}>
          {!d ? <SkelRows rows={7} /> : !p ? (
            <>
              <p className={css.empty}>{L("No commission policy is approved yet. Nothing is calculated until one is.", "Tiada polisi komisen diluluskan lagi. Tiada apa dikira sehingga ada.")}</p>
              <p className={css.sub}>{L(`The first payroll that can carry commission is ${ym(d.start.slice(0, 7))}; only invoices paid in full from ${dmy(d.start)} count.`, `Gaji pertama yang boleh membawa komisen ialah ${ym(d.start.slice(0, 7))}; hanya invois yang dibayar penuh mulai ${dmy(d.start)} dikira.`)}</p>
            </>
          ) : (
            <>
              <div className={css.head}><h3>{p.name}</h3><span className={chipSuccess}>{L("In force", "Berkuat kuasa")} · v{p.version}</span></div>
              <dl className={css.terms}>
                <div><dt>{L("Default rate", "Kadar asas")}</dt><dd>{rateText(p)}{p.rate_kind === "fixed" ? ` ${L("per invoice", "setiap invois")}` : ""}</dd></div>
                <div><dt>{L("Calculation basis", "Asas pengiraan")}</dt><dd>{basisText(p.basis)}</dd></div>
                <div><dt>{L("Package rules", "Peraturan pakej")}</dt><dd>{p.packages?.length ? L(`${p.packages.length} - see the table`, `${p.packages.length} - lihat jadual`) : L("None - every line earns the default rate", "Tiada - setiap baris memperoleh kadar asas")}</dd></div>
                <div><dt>{L("Eligibility", "Kelayakan")}</dt><dd>{L("Invoice paid in full and verified by the CEO (the owner)", "Invois dibayar penuh dan disahkan CEO (pemilik)")}</dd></div>
                <div><dt>{L("Closer", "Penutup")}</dt><dd>{L("The salesperson the invoice names, locked at the first payment; corrected only by the CEO, with a reason", "Jurujual yang dinamakan invois, dikunci pada bayaran pertama; dibetulkan oleh CEO sahaja, dengan sebab")}</dd></div>
                <div><dt>{L("Partial payment", "Bayaran sebahagian")}</dt><dd>{L("Estimate only - the whole invoice earns once it is paid in full", "Anggaran sahaja - keseluruhan invois memperoleh apabila dibayar penuh")}</dd></div>
                <div><dt>{L("Products", "Produk")}</dt><dd>{L("Services earn the default rate; a product earns only if a package rule lists it", "Servis memperoleh kadar asas; produk memperoleh hanya jika peraturan pakej menyenaraikannya")}</dd></div>
                <div><dt>{L("Leavers", "Bekas staf")}</dt><dd>{L("Their final payroll, or recorded by the CEO as paid in the final settlement", "Gaji terakhir mereka, atau direkod CEO sebagai dibayar dalam penyelesaian akhir")}</dd></div>
                <div><dt>{L("Agent deals", "Urusan ejen")}</dt><dd>{agentTerms(p) ?? L("Not in this version - an agent-linked sale is held for review, never paid as a direct sale", "Tiada dalam versi ini - jualan berkaitan ejen ditahan untuk semakan, tidak dibayar sebagai jualan langsung")}</dd></div>
                {agentTerms(p) && <div><dt>{L("Agent customers' renewals", "Pembaharuan pelanggan ejen")}</dt><dd>{L("Every later invoice for an agent's customer goes to the CEO's review (R3)", "Setiap invois kemudian untuk pelanggan ejen pergi ke semakan CEO (R3)")}</dd></div>}
                <div><dt>{L("Recurring services", "Servis berulang")}</dt><dd>{L("Every paid monthly invoice earns for its closer (approved 29-10-2026)", "Setiap invois bulanan dibayar memperoleh untuk penutupnya (diluluskan 29-10-2026)")}</dd></div>
                <div><dt>{L("Refunds and cancellations", "Bayaran balik dan pembatalan")}</dt><dd>{L("A reversal for the CEO's review; never deducted from paid wages", "Pembalikan untuk semakan CEO; tidak dipotong daripada gaji yang dibayar")}</dd></div>
                <div><dt>{L("Payroll cutoff", "Potongan gaji")}</dt><dd>{L("Confirmed by a month's last day -> that month, if not yet released; otherwise carried to the next open month", "Disahkan sebelum hari terakhir bulan -> bulan itu, jika belum dikeluarkan; jika tidak, dibawa ke bulan terbuka seterusnya")}</dd></div>
                <div><dt>{L("In force from", "Berkuat kuasa mulai")}</dt><dd>{dmy(p.effective_from)} · {L("by the day the money landed", "mengikut hari wang diterima")}</dd></div>
              </dl>
            </>
          )}
        </div>
        <div className={card}>
          <div className={css.head}><h3>{L("Approval and audit", "Kelulusan dan audit")}</h3></div>
          <dl className={css.gov}>
            <div><dt>{L("Drafts", "Draf")}</dt><dd>{L("The CEO or COO, with a reason", "CEO atau COO, dengan sebab")}</dd></div>
            <div><dt>{L("Approval", "Kelulusan")}</dt><dd>{L("The CEO only", "CEO sahaja")}</dd></div>
            <div><dt>{L("Effective date", "Tarikh berkuat kuasa")}</dt><dd>{L("Today or later - never back-dated", "Hari ini atau kemudian - tidak sekali-kali ke belakang")}</dd></div>
            <div><dt>{L("History", "Sejarah")}</dt><dd>{L("Every version is kept and never edited; an entitlement keeps the version it was earned under", "Setiap versi disimpan dan tidak diubah; hak kekal dengan versi semasa diperoleh")}</dd></div>
            <div><dt>{L("Fixed rules", "Peraturan tetap")}</dt><dd>{L("Eligibility, renewals, refunds, the cutoff, leavers and products are the approved rules, carried by every version; a different rule needs the owner's approval first", "Kelayakan, pembaharuan, bayaran balik, potongan, bekas staf dan produk ialah peraturan diluluskan, dibawa oleh setiap versi; peraturan lain memerlukan kelulusan pemilik dahulu")}</dd></div>
            <div><dt>{L("CCO", "CCO")}</dt><dd>{L("Read-only monitoring", "Pemantauan baca sahaja")}</dd></div>
          </dl>
        </div>
      </TabZone>

      {p && (
        <TabZone label={p.packages?.length ? L("Package rules and examples", "Peraturan pakej dan contoh") : L("Examples from recent invoices", "Contoh daripada invois terkini")}
          hint={L("Each example uses the latest price the package was invoiced at - real invoices, not samples. Service lines that match no rule earn the default rate; product lines earn nothing unless listed.", "Setiap contoh menggunakan harga terkini pakej itu diinvoiskan - invois sebenar, bukan sampel. Baris servis yang tidak sepadan memperoleh kadar asas; baris produk tiada komisen melainkan disenaraikan.")}>
          <div className={card}>
            {examples.length === 0 ? <p className={css.empty}>{L("No invoice lines in the last 180 days to show.", "Tiada baris invois dalam 180 hari lepas untuk dipaparkan.")}</p> : (
              <div className={css.tableWrap}>
                <table className={css.table} aria-label={L("Package examples", "Contoh pakej")}>
                  <thead><tr><th>{L("Service or package", "Servis atau pakej")}</th><th className={css.num}>{L("Latest price", "Harga terkini")}</th><th>{L("Rule", "Peraturan")}</th><th className={css.num}>{L("Commission", "Komisen")}</th></tr></thead>
                  <tbody>{examples.map((x) => (
                    <tr key={x.name}><td className={css.wrapCell}>{x.rule ? pkgLabel(x.rule) : x.name}</td><td className={css.num}>{x.price === null ? "—" : fmtRM(x.price)}</td>
                      <td>{x.rule ? pkgRuleText(x.rule) : L(`Default · ${rateText(p)}`, `Asas · ${rateText(p)}`)}</td>
                      <td className={`${css.num} ${css.strong}`}>{x.price === null ? "—" : fmtRM(pkgOn(x.rule, p, x.price))}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className={css.sub}>{L("A percentage applies to the line's share of the basis (after discounts, without SST and delivery); a fixed amount is per unit sold.", "Peratusan dikenakan pada bahagian asas baris (selepas diskaun, tanpa SST dan penghantaran); jumlah tetap adalah seunit dijual.")}</p>
          </div>
        </TabZone>
      )}

      <div id="commission-versions" />
      <TabZone label={L("Versions", "Versi")} hint={L("Drafts, approvals and rejections, newest first. A preview applies a version to the last 60 days of confirmed invoices and writes nothing.", "Draf, kelulusan dan penolakan, terbaru dahulu. Pratonton menggunakan versi pada 60 hari invois disahkan dan tidak menulis apa-apa.")}>
        <div className={card}>
          {!d ? <SkelRows rows={3} /> : (
            <div className={css.body}>
              {d.can_draft && !form && <div className={css.formRow}><button type="button" className={btnSmPrimary} onClick={() => startDraft()}><AppIcon name="add" />{L("Draft a new version", "Draf versi baharu")}</button></div>}
                            {form && (
                <fieldset className={css.form} disabled={busy}>
                  <p className={css.groupLabel}>{L("New version (draft)", "Versi baharu (draf)")}</p>
                  <div className={css.row}>
                    <label>{L("Name", "Nama")}<input aria-label={L("Policy name", "Nama polisi")} className={inputClass} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                    <label>{L("Effective from (day the money lands)", "Berkuat kuasa mulai (hari wang diterima)")}<input type="date" aria-label={L("Effective from", "Berkuat kuasa mulai")} className={inputClass} min={floor} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
                  </div>
                  <div className={css.row}>
                    <label>{L("Default rate kind", "Jenis kadar asas")}<select aria-label={L("Rate kind", "Jenis kadar")} className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })}><option value="percent">{L("Percentage of the basis", "Peratusan asas")}</option><option value="fixed">{L("Fixed amount per invoice", "Jumlah tetap setiap invois")}</option></select></label>
                    {form.kind === "percent"
                      ? <label>{L("Default rate (%)", "Kadar asas (%)")}<input type="number" aria-label={L("Rate percent", "Kadar peratus")} min="0.01" max="50" step="0.01" className={inputClass} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
                      : <label>{L("Amount (RM)", "Jumlah (RM)")}<input type="number" aria-label={L("Fixed amount", "Jumlah tetap")} min="0.01" step="0.01" className={inputClass} value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} /></label>}
                  </div>
                  <label>{L("Calculation basis", "Asas pengiraan")}<select aria-label={L("Calculation basis", "Asas pengiraan")} className={inputClass} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as "net_of_tax_delivery" | "invoice_total" })}>
                    <option value="net_of_tax_delivery">{basisText("net_of_tax_delivery")}</option><option value="invoice_total">{basisText("invoice_total")}</option></select></label>
                  <div className={css.pkgBox}>
                    <p className={css.groupLabel}>{L("Package rules (optional)", "Peraturan pakej (pilihan)")}</p>
                    <p className={css.sub}>{L("Choose a library package (every line of an invoice made from it follows the rule), or name a line exactly as it is written on invoices. Service lines that match no rule earn the default rate; product lines earn nothing unless listed here.", "Pilih pakej pustaka (setiap baris invois yang dibuat daripadanya mengikut peraturan), atau namakan baris tepat seperti pada invois. Baris servis yang tidak sepadan memperoleh kadar asas; baris produk tiada komisen melainkan disenaraikan di sini.")}</p>
                    <datalist id="comm-pkg-names">{[...(sug?.from_invoices.map((x) => x.name) ?? []), ...(sug?.rate_card ?? [])].filter((v, i, a) => a.findIndex((y) => keyOf(y) === keyOf(v)) === i).map((n) => <option key={n} value={n} />)}</datalist>
                    {form.packages.map((x, i) => (
                      <div key={i} className={css.pkgRow}>
                        {!!sug?.library?.length && <label>{L("Library package", "Pakej pustaka")}<select aria-label={L(`Package ${i + 1} library package`, `Pakej pustaka ${i + 1}`)} className={inputClass} value={x.pkgId ?? ""} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; setForm({ ...form, packages: form.packages.map((y, j) => j === i ? { ...y, pkgId: id, name: id ? (sug.library!.find((q) => q.id === id)?.name ?? "") : "" } : y) }); }}>
                          <option value="">{L("— a line name instead —", "— nama baris sebaliknya —")}</option>{sug.library.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></label>}
                        {!x.pkgId && <label>{L("Line name", "Nama baris")}<input list="comm-pkg-names" aria-label={L(`Package ${i + 1} name`, `Nama pakej ${i + 1}`)} className={inputClass} maxLength={120} value={x.name} onChange={(e) => setForm({ ...form, packages: form.packages.map((y, j) => j === i ? { ...y, name: e.target.value } : y) })} /></label>}
                        <label>{L("Rule", "Peraturan")}<select aria-label={L(`Package ${i + 1} rule`, `Peraturan pakej ${i + 1}`)} className={inputClass} value={x.rule} onChange={(e) => setForm({ ...form, packages: form.packages.map((y, j) => j === i ? { ...y, rule: e.target.value as PkgForm["rule"], value: "" } : y) })}>
                          <option value="percent">{L("Percentage", "Peratusan")}</option><option value="fixed">{L("Fixed per unit", "Tetap seunit")}</option><option value="none">{L("No commission", "Tiada komisen")}</option></select></label>
                        {x.rule !== "none"
                          ? <label>{x.rule === "percent" ? L("Rate (%)", "Kadar (%)") : L("Amount (RM)", "Jumlah (RM)")}<input type="number" aria-label={L(`Package ${i + 1} value`, `Nilai pakej ${i + 1}`)} min="0" max={x.rule === "percent" ? "50" : undefined} step="0.01" className={inputClass} value={x.value} onChange={(e) => setForm({ ...form, packages: form.packages.map((y, j) => j === i ? { ...y, value: e.target.value } : y) })} /></label>
                          : <span className={css.sub}>{L("Earns nothing", "Tiada komisen")}</span>}
                        <button type="button" className={btnSm} aria-label={L(`Remove package ${i + 1}`, `Buang pakej ${i + 1}`)} onClick={() => setForm({ ...form, packages: form.packages.filter((_, j) => j !== i) })}>{L("Remove", "Buang")}</button>
                      </div>
                    ))}
                    {form.packages.length < 50 && <div className={css.formRow}><button type="button" className={btnSm} onClick={() => setForm({ ...form, packages: [...form.packages, { name: "", rule: "percent", value: "", pkgId: null }] })}><AppIcon name="add" />{L("Add a package rule", "Tambah peraturan pakej")}</button></div>}
                  </div>
                  {form.kind === "percent" && (
                    <div className={css.pkgBox} data-testid="agent-rates">
                      <label className={css.formRow}><input type="checkbox" checked={form.agentOn} onChange={(e) => setForm({ ...form, agentOn: e.target.checked })} /> {L("Agent partnership deals", "Urusan perkongsian ejen")}</label>
                      <p className={css.sub}>{L("Rates on the eligible net sales value of a verified agent sale - not shares of the closer's commission. Without them, an agent-linked sale is held for review.", "Kadar atas nilai jualan bersih yang layak bagi jualan ejen yang disahkan - bukan bahagian komisen penutup. Tanpanya, jualan berkaitan ejen ditahan untuk semakan.")}</p>
                      {form.agentOn && <div className={css.row}>
                        <label>{L("Agent rate (%)", "Kadar ejen (%)")}<input type="number" aria-label={L("Agent rate percent", "Kadar ejen peratus")} min="0.01" max="50" step="0.01" className={inputClass} value={form.agentRate} onChange={(e) => setForm({ ...form, agentRate: e.target.value })} /></label>
                        <label>{L("Verified closer rate (%)", "Kadar penutup disahkan (%)")}<input type="number" aria-label={L("Closer rate percent", "Kadar penutup peratus")} min="0.01" max="50" step="0.01" className={inputClass} value={form.closerRate} onChange={(e) => setForm({ ...form, closerRate: e.target.value })} /></label>
                      </div>}
                      {form.agentOn && <p className={Math.round((Number(form.agentRate) + Number(form.closerRate)) * 100) === Math.round(Number(form.rate) * 100) ? css.sub : `${css.note} ${css.warnNote}`}>
                        {L(`Direct ${form.rate || "—"}% · Agent deals: agent ${form.agentRate || "—"}% + closer ${form.closerRate || "—"}% = ${(Number(form.agentRate) + Number(form.closerRate)).toFixed(2).replace(/\.00$/, "")}%`, `Langsung ${form.rate || "—"}% · Urusan ejen: ejen ${form.agentRate || "—"}% + penutup ${form.closerRate || "—"}% = ${(Number(form.agentRate) + Number(form.closerRate)).toFixed(2).replace(/\.00$/, "")}%`)}
                        {" · "}{L("Renewals and repeat orders of an agent's customer: the CEO reviews each (R3)", "Pembaharuan dan pesanan ulangan pelanggan ejen: CEO menyemak setiap satu (R3)")}</p>}
                    </div>
                  )}
                  <label>{L("Reason for this version", "Sebab versi ini")}<textarea aria-label={L("Policy reason", "Sebab polisi")} className={inputClass} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                  <p className={css.sub}>{L("Every version carries the approved fixed rules: the whole invoice paid and confirmed, every paid renewal, refunds to review, the payroll cutoff, leavers (final payroll or settlement) and products (listed only). Changing one needs the owner's approval first.", "Setiap versi membawa peraturan tetap yang diluluskan: keseluruhan invois dibayar dan disahkan, setiap pembaharuan dibayar, bayaran balik untuk semakan, potongan gaji, bekas staf (gaji terakhir atau penyelesaian) dan produk (disenaraikan sahaja). Mengubahnya memerlukan kelulusan pemilik dahulu.")}</p>
                  <div className={css.formRow}>
                    <button type="button" className={btnClass} disabled={form.name.trim().length < 3 || form.reason.trim().length < 10 || (form.kind === "percent" ? !(Number(form.rate) > 0) : !(Number(form.fixed) > 0)) || !form.packages.every(pkgValid) || (form.agentOn && form.kind === "percent" && !(Number(form.agentRate) > 0 && Number(form.closerRate) > 0))} onClick={() => void saveDraft()}><AppIcon name="save" />{L("Save draft", "Simpan draf")}</button>
                    <button type="button" className={btnSm} onClick={() => setForm(null)}>{L("Cancel", "Batal")}</button>
                  </div>
                </fieldset>
              )}
              {error && <p role="alert" className={css.error}>{error}</p>}
              {d.versions.length === 0 ? <p className={css.empty}>{L("No version yet.", "Belum ada versi.")}</p> : (
                <ul className={css.list}>
                  {d.versions.map((v) => (
                    <li key={v.id}>
                      <span className={css.listMain}>
                        <strong>v{v.version} · {v.name} · {rateText(v)} · {L("from", "mulai")} {dmy(v.effective_from)}</strong>
                        <span>{basisText(v.basis)}</span>
                        {agentTerms(v) && <span>{agentTerms(v)}{v.agent_mismatch_reason ? ` · ${L("approved with the reason", "diluluskan dengan sebab")}: ${v.agent_mismatch_reason}` : ""}</span>}
                        {!!v.packages?.length && <span>{L("Packages", "Pakej")}: {v.packages.map((x) => `${pkgLabel(x)} ${pkgRuleText(x)}`).join(" · ")}</span>}
                        <span>{L("Drafted by", "Draf oleh")} {v.created_by_name ?? "—"} · {dmyMYT(v.created_at)} · {v.reason}</span>
                        {v.status === "active" && <span>{L("Approved by", "Diluluskan oleh")} {v.approved_by_name ?? "—"} · {v.approved_at ? dmyMYT(v.approved_at) : ""}</span>}
                        {v.status === "rejected" && <span>{L("Rejected by", "Ditolak oleh")} {v.rejected_by_name ?? "—"} · {v.reject_reason}</span>}
                      </span>
                      <span className={css.formRow}>
                        {(() => { const [t, c] = lifecycle(v, p, d.today); return <span className={c}>{t}</span>; })()}
                        <button type="button" className={btnSm} onClick={() => openPreview(v)}><AppIcon name="preview" />{L("Preview", "Pratonton")}</button>
                        {v.status === "draft" && d.can_approve && <><button type="button" className={btnSmPrimary} onClick={() => void approve(v)}><AppIcon name="success" />{L("Approve", "Luluskan")}</button><button type="button" className={btnSm} onClick={() => void reject(v)}>{L("Reject", "Tolak")}</button></>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </TabZone>
      <SideDrawer open={preview !== null} onClose={() => setPreview(null)} wide title={L("Policy preview", "Pratonton polisi")} subtitle={preview?.d ? `v${preview.d.policy.version} · ${rateText(preview.d.policy)} · ${L("last 60 days, nothing written", "60 hari lepas, tiada apa ditulis")}` : undefined}>
        {preview?.e ? <p role="alert" className={css.error}>{preview.e}</p> : !preview?.d ? <SkelRows rows={6} /> : preview.d.rows.length === 0 ? <p className={css.empty}>{L("No confirmed invoice in the last 60 days.", "Tiada invois disahkan dalam 60 hari lepas.")}</p> : (
          <div className={css.body}>
            <p className={css.note}>{L(`This version would pay ${fmtRM(preview.d.total_cents)} on these invoices. A preview only: past entitlements keep the version they were earned under.`, `Versi ini akan membayar ${fmtRM(preview.d.total_cents)} atas invois ini. Pratonton sahaja.`)}</p>
            <div className={css.tableWrap}>
              <table className={css.table} aria-label={L("Preview", "Pratonton")}>
                <thead><tr><th>{L("Invoice", "Invois")}</th><th>{L("Closer", "Penutup")}</th><th className={css.num}>{L("Basis", "Asas")}</th><th className={css.num}>{L("This version", "Versi ini")}</th><th className={css.num}>{L("In force", "Berkuat kuasa")}</th></tr></thead>
                <tbody>{preview.d.rows.map((r) => <tr key={r.invoice_id}><td>{r.doc_number}<br /><span className={css.sub}>{r.company ?? "—"} · {dmy(r.paid_day)}</span></td><td>{r.closer_name ?? "—"}</td><td className={css.num}>{fmtRM(r.basis_cents)}</td><td className={css.num}>{fmtRM(r.amount_cents)}</td><td className={css.num}>{r.current_cents === null ? "—" : `${fmtRM(r.current_cents)} · v${r.current_version}`}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </SideDrawer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Payroll Sync (v1.227.0) - the switch, the cutoff, what is waiting    */
function PayrollView({ revision, onChanged, summary }: { revision: number; onChanged: () => void; summary: Summary | null }) {
  const [tick, setTick] = useState(0);
  const { d, e: loadErr } = usePolicy(revision, tick);
  const [switchReason, setSwitchReason] = useState("");
  const [error, setError] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const p = d?.in_force ?? null;
  /* v1.232.0 (audit F2) - commission given to a month the payslip does not carry */
  const [nos, setNos] = useState<{ rev: number; v: { n: number; cents: number } | null } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<FlowResp>(`/flow`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setNos({ rev: revision, v: r.ok && r.data ? r.data.exceptions.not_on_payslip ?? null : null }); });
    return () => c.abort();
  }, [revision]);
  const flip = async (on: boolean) => {
    if (!(await confirm({ title: on ? L("Switch commission into payroll?", "Hidupkan komisen ke dalam gaji?") : L("Switch commission out of payroll?", "Matikan komisen daripada gaji?"), message: on ? L("Eligible commission will be given to the next open payroll month, once. Released months are never changed.", "Komisen layak akan dimasukkan ke bulan gaji terbuka seterusnya, sekali. Bulan yang dikeluarkan tidak diubah.") : L("Payroll stops taking new commission. What a month already holds stays until you recompute it.", "Gaji berhenti mengambil komisen baharu."), confirmLabel: on ? L("Switch on", "Hidupkan") : L("Switch off", "Matikan") }))) return;
    setError("");
    const r = await api(`/settings`, { method: "POST", body: JSON.stringify({ sync: on ? "on" : "off", reason: switchReason }) });
    if (r.ok) { setSwitchReason(""); toast(on ? L("Payroll switched on", "Gaji dihidupkan") : L("Payroll switched off", "Gaji dimatikan"), L("Logged with your reason", "Direkod dengan sebab anda")); setTick((x) => x + 1); onChanged(); } else setError(message(r));
  };
  return (
    <>
      {toastNode}{confirmNode}
      {loadErr ? <p role="alert" className={css.error}>{loadErr}</p> : null}
      {nos?.v && nos.v.n > 0 && <p role="status" className={`${css.note} ${css.warnNote}`}>{L(`${nos.v.n} entitlement(s), ${fmtRM(nos.v.cents)}, are in a payroll month but not on the payslip. Payroll (HR) should recompute that month; the bank run holds them until the payslip carries them.`, `${nos.v.n} hak, ${fmtRM(nos.v.cents)}, berada dalam bulan gaji tetapi tiada dalam slip gaji. Gaji (HR) perlu mengira semula bulan itu; pembayaran bank menahannya sehingga slip gaji membawanya.`)}</p>}
      <TabZone label={L("Payroll link", "Pautan gaji")} hint={L("Until it is switched on, entitlements are recorded and shown, and payroll ignores them - so the figures can be checked first.", "Sehingga dihidupkan, hak direkod dan dipaparkan, dan gaji tidak mengambilnya - supaya angka boleh disemak dahulu.")} cols={2}>
        <div className={card}>
          {!d ? <SkelRows rows={3} /> : (
            <div className={css.body}>
              <div className={css.head}><h3>{d.sync ? L("On - payroll takes eligible commission", "Hidup - gaji mengambil komisen layak") : L("Off - recorded only (shadow)", "Mati - direkod sahaja (bayang)")}</h3><span className={d.sync ? chipSuccess : chipWarn}>{d.sync ? L("On", "Hidup") : L("Off", "Mati")}</span></div>
              {d.can_switch ? (
                <fieldset className={css.form}>
                  <label>{L("Reason", "Sebab")}<input aria-label={L("Switch reason", "Sebab suis")} className={inputClass} maxLength={500} value={switchReason} onChange={(e) => setSwitchReason(e.target.value)} placeholder={L("e.g. Checked the November entitlements", "cth. Telah menyemak hak November")} /></label>
                  <div className={css.formRow}><button type="button" className={d.sync ? btnSm : btnSmPrimary} disabled={switchReason.trim().length < 10 || (!d.sync && !p)} onClick={() => void flip(!d.sync)}><AppIcon name="lock" />{d.sync ? L("Switch payroll off", "Matikan gaji") : L("Switch payroll on", "Hidupkan gaji")}</button>
                    {!d.sync && !p && <span className={css.sub}>{L("Approve a policy first.", "Luluskan polisi dahulu.")}</span>}</div>
                </fieldset>
              ) : <p className={css.sub}>{L("Only the CEO switches commission into payroll.", "Hanya CEO menghidupkan komisen ke dalam gaji.")}</p>}
              {error && <p role="alert" className={css.error}>{error}</p>}
            </div>
          )}
        </div>
        <div className={card}>
          <div className={css.head}><h3>{L("How payroll takes commission", "Bagaimana gaji mengambil komisen")}</h3></div>
          <dl className={css.gov}>
            <div><dt>{L("Which month", "Bulan mana")}</dt><dd>{L("Confirmed by a month's last day -> that month's payroll, if its payslips are not yet released", "Disahkan sebelum hari terakhir bulan -> gaji bulan itu, jika slip gaji belum dikeluarkan")}</dd></div>
            <div><dt>{L("Carry-forward", "Bawa ke hadapan")}</dt><dd>{L("Anything later, or for a released month, goes to the next open month", "Selebihnya, atau untuk bulan yang dikeluarkan, ke bulan terbuka seterusnya")}</dd></div>
            <div><dt>{L("Once", "Sekali")}</dt><dd>{L("Saving a person's payroll takes only that person's entitlements, once; opening payroll takes nothing; a future month, or a month whose payslips are out, takes nothing new", "Menyimpan gaji seseorang mengambil hak orang itu sahaja, sekali; membuka gaji tidak mengambil apa-apa; bulan akan datang, atau bulan yang slip gajinya telah keluar, tidak mengambil yang baharu")}</dd></div>
            <div><dt>{L("Paid", "Dibayar")}</dt><dd>{L("Only when the month's bank run is recorded as done, and only what the person's payslip carries - anything else is held. Never because the customer paid", "Hanya apabila pembayaran bank bulan itu direkod selesai, dan hanya yang dibawa slip gaji - selebihnya ditahan. Bukan kerana pelanggan membayar")}</dd></div>
            <div><dt>{L("Release", "Keluaran")}</dt><dd>{L("The CEO, COO or admins; the CCO cannot", "CEO, COO atau pentadbir; CCO tidak boleh")}</dd></div>
          </dl>
        </div>
      </TabZone>
      <TabZone label={L("Where commission stands", "Kedudukan komisen")}>
        {!summary ? <KpiRow label={L("Payroll figures", "Angka gaji")}><SkelStat /><SkelStat /><SkelStat /></KpiRow> : (
          <KpiRow label={L("Payroll figures", "Angka gaji")}>
            <KpiTile icon="verify" tone="gold" label={L("Eligible, waiting for payroll", "Layak, menunggu gaji")} value={fmtRM(summary.eligible.cents)} sub={L(`${summary.eligible.n} entr(ies)`, `${summary.eligible.n} entri`)} />
            <KpiTile icon="money" tone="blue" label={L("Included in payroll", "Dalam gaji")} value={fmtRM(summary.included.cents)} sub={summary.sync ? L("bank run not yet done", "pembayaran bank belum selesai") : L("payroll link is off", "pautan gaji mati")} />
            <KpiTile icon="paid" tone="green" label={L("Paid", "Dibayar")} value={fmtRM(summary.paid.cents)} sub={L(`${ym(summary.month)} payroll`, `Gaji ${ym(summary.month)}`)} />
          </KpiRow>
        )}
      </TabZone>
      {d && d.log.length > 0 && (
        <TabZone label={L("Switch history", "Sejarah suis")}>
          <div className={card}><ul className={css.list}>{d.log.map((x, i) => <li key={i}><span className={css.listMain}><strong>{x.value === "on" ? L("Switched on", "Dihidupkan") : L("Switched off", "Dimatikan")} · {x.changed_by_name ?? "—"}</strong><span>{dmyMYT(x.changed_at)} · {x.reason}</span></span></li>)}</ul></div>
        </TabZone>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Audit History (v1.227.0) - every decision, newest first              */
const ACTIONS: Record<string, [string, string]> = {
  "commission.policy_draft": ["Policy drafted", "Polisi didraf"], "commission.policy_approve": ["Policy approved", "Polisi diluluskan"],
  "commission.policy_reject": ["Policy rejected", "Polisi ditolak"], "commission.sync": ["Payroll switch", "Suis gaji"],
  "commission.apply": ["Review applied", "Semakan dilaksanakan"], "commission.dismiss": ["Review dismissed", "Semakan ditolak"],
  "commission.settled": ["Settled outside payroll", "Diselesaikan di luar gaji"], "doc.closer_correct": ["Closer corrected", "Penutup dibetulkan"],
  "doc.closer_change": ["Closer changed before payment", "Penutup ditukar sebelum bayaran"],
  "commission.settle": ["Settled in the final settlement", "Diselesaikan dalam penyelesaian akhir"],
  "commission.paid_held": ["Bank run: commission held (not on the payslip)", "Pembayaran bank: komisen ditahan (tiada dalam slip gaji)"],
  "invoice.paid_confirm": ["Commission verified (paid confirmed)", "Komisen disahkan (dibayar disahkan)"], "invoice.paid_confirm_revoke": ["Confirmation taken back", "Pengesahan ditarik balik"],
  /* v1.311.0 (ref 6) - payments, agent deals, payouts and payroll writes too */
  "commission.agent_switch": ["Agent sales hold", "Tahanan jualan ejen"], "commission.attribution_partnership": ["Agent deal decided: partnership", "Urusan ejen diputuskan: perkongsian"],
  "commission.attribution_direct": ["Agent deal decided: direct sale", "Urusan ejen diputuskan: jualan langsung"], "commission.attribution_none": ["Agent deal decided: no commission", "Urusan ejen diputuskan: tiada komisen"],
  "commission.dispute": ["Attribution disputed", "Atribusi dipertikai"], "commission.dispute_clear": ["Dispute cleared", "Pertikaian diselesaikan"],
  "commission.payout_authorise": ["Agent payout authorised", "Bayaran ejen dibenarkan"], "commission.payout_settle": ["Agent payout settled (Finance)", "Bayaran ejen diselesaikan (Kewangan)"],
  "commission.payout_cancel": ["Agent payout cancelled", "Bayaran ejen dibatalkan"], "payment.reported": ["Payment reported", "Bayaran dilaporkan"],
  "payment.clarify": ["Payment: question asked", "Bayaran: soalan ditanya"], "payment.answered": ["Payment: question answered", "Bayaran: soalan dijawab"],
  "payment.proof": ["Payment proof attached", "Bukti bayaran dilampirkan"], "payment.rejected": ["Payment rejected", "Bayaran ditolak"],
  "payment.reversed": ["Payment reversed", "Bayaran dibatalkan"], "payment.settings": ["Payment verification setting", "Tetapan pengesahan bayaran"],
  "payroll.recompute": ["Payroll recomputed (sync)", "Gaji dikira semula (segerak)"], "payroll.paid": ["Payroll bank run recorded", "Pembayaran bank gaji direkod"],
  "payroll.save": ["Payroll saved", "Gaji disimpan"], "payroll.pull_commission": ["Payroll pulled commission", "Gaji menarik komisen"],
};
function detailLine(raw: string | null): string {
  if (!raw) return "";
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const bits: string[] = [];
    if (o.invoice) bits.push(String(o.invoice));
    if (o.version) bits.push(`v${o.version}`);
    if (typeof o.rate_pct === "number") bits.push(`${o.rate_pct}%`);
    if (o.effective_from) bits.push(`${L("from", "mulai")} ${dmy(String(o.effective_from))}`);
    if (Array.isArray(o.packages) && o.packages.length) bits.push(L(`${o.packages.length} package rule(s)`, `${o.packages.length} peraturan pakej`));
    if (o.value) bits.push(String(o.value) === "on" ? L("on", "hidup") : L("off", "mati"));
    const c = o.commission as { moved?: number; to_review?: number; unchanged_paid?: number } | undefined;
    if (c && (c.moved || c.to_review || c.unchanged_paid)) bits.push(L(`commission: ${c.moved ?? 0} moved, ${c.to_review ?? 0} to review, ${c.unchanged_paid ?? 0} already paid`, `komisen: ${c.moved ?? 0} dipindah, ${c.to_review ?? 0} ke semakan, ${c.unchanged_paid ?? 0} sudah dibayar`));
    const why = o.reason ?? o.note;
    if (why) bits.push(String(why));
    return bits.join(" · ");
  } catch { return ""; }
}
type AuditEv = { id: number; action: string; detail: string | null; created_at: string; who: string | null; who_role: string | null; doc_number: string | null };
type AuditResp = { events: AuditEv[]; page: number; pages: number; total: number; people: { id: number; name: string }[] };
/* v1.311.0 (ref 6, F-13) - read only, filtered on the server: a group of
   actions, a person, a Malaysian date range, pages of 50 */
function AuditView({ revision }: { revision: number }) {
  const [action, setAction] = useState("");
  const [who, setWho] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const key = `/audit?action=${action}&user=${who}&from=${from}&to=${to}&page=${page}&r=${revision}`;
  const [got, setGot] = useState<{ k: string; d: AuditResp | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<AuditResp>(key, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ k: key, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [key]);
  const cur = got?.k === key ? got : null;
  const d = cur?.d ?? null;
  const set = (f: () => void) => { f(); setPage(1); };
  const ROLE_W: Record<string, string> = { ceo: "CEO", coo: "COO", cco: "CCO", hr_admin: "HR", super_admin: "Super Admin", admin: "Admin", sales_marketing: "Sales" };
  return (
    <section className={card} aria-label={L("Audit history", "Sejarah audit")} data-testid="commission-audit">
      <div className={c5.auditFilters}>
        <select className={selectClassSm} value={action} onChange={(e) => set(() => setAction(e.target.value))} aria-label={L("Action", "Tindakan")}>
          <option value="">{L("All actions", "Semua tindakan")}</option>
          <option value="payment">{L("Payments and verification", "Bayaran dan pengesahan")}</option>
          <option value="policy">{L("Policy and switches", "Polisi dan suis")}</option>
          <option value="deal">{L("Agent deals, reviews and closers", "Urusan ejen, semakan dan penutup")}</option>
          <option value="payroll">{L("Payroll", "Gaji")}</option>
          <option value="payout">{L("Agent payouts", "Bayaran ejen")}</option>
        </select>
        <select className={selectClassSm} value={who} onChange={(e) => set(() => setWho(Number(e.target.value)))} aria-label={L("User", "Pengguna")}>
          <option value={0}>{L("All users", "Semua pengguna")}</option>
          {(d?.people ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" className={inputClassSm} value={from} max={to || undefined} onChange={(e) => set(() => setFrom(e.target.value))} aria-label={L("From", "Dari")} />
        <input type="date" className={inputClassSm} value={to} min={from || undefined} onChange={(e) => set(() => setTo(e.target.value))} aria-label={L("To", "Hingga")} />
      </div>
      {cur?.e ? <p role="alert" className={css.error}>{cur.e}</p> : !d ? <SkelRows rows={6} /> : d.events.length === 0 ? <p className={css.empty}>{L("Nothing recorded for these filters.", "Tiada rekod untuk penapis ini.")}</p> : (
        <>
          <div className={c5.tWrap}>
            <table className={c5.t}>
              <thead><tr><th>{L("Date & Time", "Tarikh & Masa")}</th><th>{L("Action", "Tindakan")}</th><th>{L("Details", "Butiran")}</th><th>{L("By", "Oleh")}</th></tr></thead>
              <tbody>{d.events.map((x) => (
                <tr key={x.id}>
                  <td className={c5.muted}>{dmyMYT(x.created_at)}</td>
                  <td><strong>{ACTIONS[x.action] ? L(ACTIONS[x.action]![0], ACTIONS[x.action]![1]) : x.action}</strong></td>
                  <td>{[x.doc_number, detailLine(x.detail)].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{x.who ?? "—"}{x.who_role && ROLE_W[x.who_role] ? ` (${ROLE_W[x.who_role]})` : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {d.pages > 1 && (
            <nav className={c5.pager} aria-label={L("Pages", "Halaman")}>
              <button type="button" className={btnSm} disabled={d.page <= 1} onClick={() => setPage(d.page - 1)} aria-label={L("Previous page", "Halaman sebelum")}>‹</button>
              {Array.from({ length: d.pages }, (_, i2) => i2 + 1).filter((n) => Math.abs(n - d.page) <= 2 || n === 1 || n === d.pages).map((n) => (
                <button key={n} type="button" className={n === d.page ? btnSmPrimary : btnSm} aria-current={n === d.page ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
              ))}
              <button type="button" className={btnSm} disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)} aria-label={L("Next page", "Halaman seterusnya")}>›</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* v1.311.0 - COMMISSION WORKSPACE 5.0 (the CEO, 15-11-2026, K-0 ... K-13):
   six views in the address (Back/Forward), the phone's view switch with New
   Deal beside it, the month and the company on the tab row; a person who
   reads only their own commission has one view, My commission. Every
   decision stays where it was (the entry drawer, Agent deals, payouts). */
export function CommissionPanel({ user, go, startView, onCreateQuotation }: { user: { id: number; role: string }; go?: (t: string) => void; startView?: string; onCreateQuotation?: () => void }) {
  const all = VIEW_ALL.includes(user.role);
  const [view, setView] = useState<View>(() => (all && isCommissionView(startView ?? null) ? startView as View : all ? "overview" : "transactions"));
  const [scope, setScope] = useState<WsScope>(all ? "all" : "mine");
  const [month, setMonth] = useState(() => mytToday().slice(0, 7));
  const [company, setCompany] = useState<Company>("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const [entry, setEntry] = useState<number | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  const sKey = `${scope}|${revision}`;
  const [sum, setSum] = useState<{ k: string; d: Summary | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<Summary>(`/summary?scope=${sKey.split("|")[0]}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setSum({ k: sKey, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [sKey]);
  const s = sum?.k === sKey ? sum.d : null;
  const VIEW_TABS: readonly (readonly [View, string, string])[] = all
    ? [["overview", L("Overview", "Gambaran"), L("Summary, performance and status", "Ringkasan, prestasi dan status")],
      ["transactions", L("Transactions", "Transaksi"), L("Commission by invoice and status", "Komisen mengikut invois dan status")],
      ["agents", L("Agent Deals", "Urusan Ejen"), L("Agents and referrals under a salesperson", "Ejen dan rujukan di bawah jurujual")],
      ["policy", L("Policy Settings", "Tetapan Polisi"), L("Structure, rates and rules", "Struktur, kadar dan peraturan")],
      ["payroll", L("Payroll Sync", "Penyegerakan Gaji"), L("Commission to Payroll; agents through Finance", "Komisen ke Gaji; ejen melalui Kewangan")],
      ["audit", L("Audit History", "Sejarah Audit"), L("Every change, who and when", "Setiap perubahan, siapa dan bila")]]
    : [["transactions", L("My commission", "Komisen saya"), L("Your commission by invoice", "Komisen anda mengikut invois")]];
  /* a view this person does not have falls back to their first, never a blank page */
  const shown: View = VIEW_TABS.some((t) => t[0] === view) ? view : VIEW_TABS[0]![0];
  useTabViewAddress("Commission", shown, setView as (v: CommissionView) => void, isCommissionView);
  const open = (v: View) => { setView(v); window.scrollTo({ top: 0 }); };
  const mine = !all || scope === "mine";
  const newDeal = () => (onCreateQuotation ? onCreateQuotation() : go?.("Sales"));
  const months = monthsFrom(s?.start ?? "2026-11-01");
  const toolbar = (
    <span className={c5.asideRow}>
      {all && (shown === "transactions" || shown === "overview") && <ScopeSwitch scope={scope} onChange={setScope} />}
      <select className={selectClassSm} value={month} onChange={(e) => setMonth(e.target.value)} aria-label={L("Month", "Bulan")} data-testid="commission-month">
        {(months.includes(month) ? months : [month, ...months]).map((m) => <option key={m} value={m}>{monthWord(m)}</option>)}
      </select>
      {all && shown !== "policy" && shown !== "audit" && (
        <select className={selectClassSm} value={company} onChange={(e) => setCompany(e.target.value as Company)} aria-label={L("Company", "Syarikat")} data-testid="commission-company">
          <option value="">{L("All companies", "Semua syarikat")}</option>
          <option value="a2z">A2Z Creative Marketing</option>
          <option value="azoo">AZ ONE Official</option>
        </select>
      )}
      <button type="button" className={btnSm} title={L("Refresh", "Muat semula")} aria-label={L("Refresh commission", "Muat semula komisen")} onClick={reload}><AppIcon name="refresh" /></button>
    </span>
  );
  const onEstimate = (r: TxRow) => setEst({ invoice_id: r.invoice_id, doc_number: r.doc_number, company: r.company, closer_name: r.closer_name, user_id: null, invoice_total: r.sales_cents, payment_status: null,
    received_cents: 0, stage: (r.stage as Estimate["stage"]) ?? "unpaid", package: "", created_at: r.invoice_date ?? "", estimate_cents: r.closer_cents ?? r.commission_cents, basis_cents: r.basis_cents, policy_version: null, issuer_code: r.issuer_code });
  return (
    <TabPage>
      {toastNode}
      <EntryDrawer id={entry} onClose={() => setEntry(null)} onSaved={reload} />
      <EstimateDrawer est={est} onClose={() => setEst(null)} />
      <div className="erp-desktop-only">
        <LineTabs value={shown} onChange={open} tabs={VIEW_TABS.map(([k, t]) => [k, t] as const)} label={L("Commission", "Komisen")} />
        {/* v1.311.0 - the filters sit on their own row under the six tabs, so no tab is ever cut off at 1024-1440px */}
        <div className={c5.deskBar} data-testid="commission-toolbar">{toolbar}{all && <button type="button" className={btnSmPrimary} onClick={newDeal}><AppIcon name="add" />{L("New Deal", "Urusan Baharu")}</button>}</div>
      </div>
      <div className="erp-phone-only">
        <div className={c5.viewBar} data-testid="commission-view-bar">
          <ViewSwitch value={shown} onChange={(k) => open(k)} label={L("Commission view", "Paparan komisen")} options={VIEW_TABS} />
          {all && <button type="button" className={btnSmPrimary} onClick={newDeal}><AppIcon name="add" />{L("New Deal", "Urusan Baharu")}</button>}
        </div>
        <div className={c5.phoneFilters}>{toolbar}</div>
      </div>
      {sum?.e && <p role="alert" className={css.error}>{sum.e}</p>}
      {s && !s.policy && shown !== "audit" && <p className={`${css.note} ${css.warnNote}`}>{L("No commission policy is approved yet - nothing is estimated or earned until the CEO approves one (Policy Settings).", "Tiada polisi komisen diluluskan lagi - tiada apa dianggar atau diperoleh sehingga CEO meluluskannya (Tetapan Polisi).")}</p>}
      {all && <div className={css.body} hidden={shown !== "overview"}>
        <Overview5 month={month} company={company} mine={mine} rev={revision} open={open} onEntry={setEntry} goSales={() => go?.("Sales")} />
      </div>}
      <div className={css.body} hidden={shown !== "transactions"}>
        {!all && <Overview5 month={month} company="" mine rev={revision} open={open} onEntry={setEntry} goSales={() => go?.("Sales")} />}
        <Transactions5 month={month} company={company} mine={mine} rev={revision} onEntry={setEntry} onEstimate={onEstimate} />
      </div>
      {all && <div className={css.body} hidden={shown !== "agents"}>{shown === "agents" && <>
        <AgentsHead5 month={month} company={company} rev={revision} onAddAgent={() => go?.("Agents")} />
        <AgentDeals revision={revision} onChanged={reload} part="deals" />
      </>}</div>}
      {all && <div className={css.body} hidden={shown !== "policy"}>{shown === "policy" && <PolicyView revision={revision} onChanged={reload} />}</div>}
      {all && <div className={css.body} hidden={shown !== "payroll"}>{shown === "payroll" && <>
        <PayrollSync5 month={month} rev={revision} onChanged={reload} toast={toast} />
        <AgentDeals revision={revision} onChanged={reload} part="payouts" />
        {sum ? <PayrollView revision={revision} onChanged={reload} summary={s} /> : <SkelRows rows={4} />}{/* the payroll link waits on the panel's own summary */}
      </>}</div>}
      {all && <div className={css.body} hidden={shown !== "audit"}>{shown === "audit" && <AuditView revision={revision} />}</div>}
    </TabPage>
  );
}
