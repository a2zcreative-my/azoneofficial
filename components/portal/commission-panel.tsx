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
import { LineTabs, TabAside } from "@/components/ui/line-tabs";
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
import { btnClass, btnSm, btnSmPrimary, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import type { Policy, Summary } from "@/components/portal/commission-card";
import css from "./commission.module.css";

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
}
interface Estimate {
  invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; user_id: number | null; invoice_total: number; payment_status: string | null;
  received_cents: number; stage: "unpaid" | "part_paid" | "awaiting_confirmation"; package: string; created_at: string;
  estimate_cents: number | null; basis_cents: number | null; policy_version: number | null;
  issuer_code?: string | null; next?: string;
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
  confirm_paid: ["Confirm Paid (Sales -> Closed Sales)", "Sahkan Dibayar (Jualan -> Jualan Ditutup)", "CEO or COO", "CEO atau COO"],
  ceo_decides: ["Decide the review", "Putuskan semakan", "CEO", "CEO"],
  payroll_off: ["Waits for the payroll switch", "Menunggu suis gaji", "CEO", "CEO"],
  next_payroll: ["Goes into the next open payroll", "Masuk gaji terbuka seterusnya", "Payroll (automatic)", "Gaji (automatik)"],
  recompute_payroll: ["Recompute the month - not on the payslip yet", "Kira semula bulan - belum dalam slip gaji", "Payroll (HR)", "Gaji (HR)"],
  await_bank_run: ["Record the bank run as done", "Rekod pembayaran bank selesai", "Finance", "Kewangan"],
  settle_leaver: ["Settle in the final settlement", "Selesaikan dalam penyelesaian akhir", "CEO", "CEO"],
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
const STAGE: Record<Estimate["stage"], [string, string]> = {
  unpaid: ["Estimate · unpaid", "Anggaran · belum dibayar"], part_paid: ["Estimate · part paid", "Anggaran · dibayar sebahagian"],
  awaiting_confirmation: ["Estimate · waiting for CEO/COO", "Anggaran · menunggu CEO/COO"],
};
const statusChip = (e: Entry) => <span className={STATUS[e.status][2]}>{L(STATUS[e.status][0], STATUS[e.status][1])}{e.status === "included" ? ` · ${ym(e.payroll_month)}` : ""}</span>;
const payWord = (s: string | null) => s === "paid" ? L("Paid in full", "Dibayar penuh") : s === "overdue" ? L("Overdue", "Tertunggak") : L("Unpaid", "Belum dibayar");

type View = "overview" | "transactions" | "policy" | "payroll" | "audit";
type Filter = "" | "estimated" | Entry["status"];

/* ------------------------------------------------------------------ */
/* One entry: every fact, every step, the review                        */
function EntryDrawer({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ id: number; d: { entry: Entry & { tax_percent: number; discount_cents: number; delivery_cents: number; policy_name: string | null; policy_basis: string | null }; related: { id: number; kind: string; status: string; amount_cents: number; payroll_month: string | null; note: string | null; created_at: string }[]; confirmations: { id: number; amount_cents: number; payment_ref: string | null; confirmed_at: string; confirmed_by_name: string | null; revoked_at: string | null; revoke_reason: string | null; revoked_by_name: string | null }[]; history: { action: string; detail: string | null; created_at: string; who: string | null }[]; breakdown?: LineCalc[] | null; can_decide: boolean } | null; e: string } | null>(null);
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
            <dt>{L("Rate · policy", "Kadar · polisi")}</dt><dd>{e.kind === "earn" ? `${rateText(e)} · v${e.policy_version ?? "—"} ${e.policy_name ?? ""}` : `v${e.policy_version ?? "—"}`}</dd>
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
          {d.can_decide && e.status === "review" && (
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
            ? L("Paid in full. It becomes eligible when the CEO or COO confirms the payment on Sales -> Closed Sales.", "Dibayar penuh. Ia menjadi layak apabila CEO atau COO mengesahkan bayaran di Jualan -> Jualan Ditutup.")
            : L("An estimate only - it earns nothing until the whole invoice is paid and the CEO or COO confirms it. A part payment never earns on its own.", "Anggaran sahaja - tiada apa diperoleh sehingga keseluruhan invois dibayar dan disahkan CEO atau COO. Bayaran sebahagian tidak memperoleh apa-apa.")}</p>
        </div>
      )}
    </SideDrawer>
  );
}

/* ------------------------------------------------------------------ */
/* Entries                                                              */
function Entries({ scope, revision, onChanged }: { scope: WsScope; revision: number; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQ(qInput.trim()), 300); return () => window.clearTimeout(t); }, [qInput]);
  const key = `${scope}|${filter}|${q}|${revision}`;
  const [got, setGot] = useState<{ key: string; entries: Entry[]; estimates: Estimate[]; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const [s, f, qq] = key.split("|");
    const p = new URLSearchParams({ scope: s!, ...(f && f !== "estimated" ? { status: f } : f === "estimated" ? { status: "estimated" } : {}), ...(qq ? { q: qq } : {}) });
    void api<{ entries: Entry[]; estimates: Estimate[] }>(`/entries?${p.toString()}`, { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ key, entries: r.ok && r.data ? (f === "estimated" ? [] : r.data.entries) : [], estimates: r.ok && r.data ? r.data.estimates : [], e: r.ok ? "" : message(r) });
    });
    return () => c.abort();
  }, [key]);
  const cur = got?.key === key ? got : null;
  const rows = cur ? cur.entries : null;
  const ests = cur ? cur.estimates : null;
  const total = (rows?.length ?? 0) + (ests?.length ?? 0);
  return (
    <TabZone label={L("Entries", "Entri")} hint={L("What each sale earned, and what it may earn once it is paid in full and the CEO or COO confirms it. Estimates are never stored or paid.", "Apa yang diperoleh setiap jualan, dan yang mungkin diperoleh apabila dibayar penuh dan disahkan CEO atau COO. Anggaran tidak disimpan atau dibayar.")}>
      <div className={card}>
        <div className={css.filters}>
          <label><span className={fieldLabel}>{L("Show", "Papar")}</span>
            <select aria-label={L("Commission status", "Status komisen")} className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="">{L("Everything", "Semua")}</option>
              <option value="estimated">{L("Estimates (not yet earned)", "Anggaran (belum diperoleh)")}</option>
              <option value="eligible">{L("Eligible", "Layak")}</option>
              <option value="review">{L("Under review", "Dalam semakan")}</option>
              <option value="included">{L("In payroll", "Dalam gaji")}</option>
              <option value="paid">{L("Paid", "Dibayar")}</option>
              <option value="void">{L("Void", "Batal")}</option>
            </select></label>
          <label><span className={fieldLabel}>{L("Search", "Cari")}</span>
            <input type="search" aria-label={L("Search commission", "Cari komisen")} className={inputClass} value={qInput} placeholder={L("Invoice, customer, closer", "Invois, pelanggan, penutup")} onChange={(e) => setQInput(e.target.value)} /></label>
        </div>
        {cur?.e ? <p role="alert" className={css.error}>{cur.e}</p> : rows === null || ests === null ? <SkelRows rows={6} /> : total === 0 ? (
          <p className={css.empty}>{L("Nothing here yet. A sale appears once its invoice is raised; it earns once paid in full and confirmed.", "Belum ada. Jualan dipaparkan apabila invois dibuat; ia diperoleh apabila dibayar penuh dan disahkan.")}</p>
        ) : (
          <>
            <div className={`${css.desk} ${css.tableWrap}`}>
              <table className={css.table} aria-label={L("Commission entries", "Entri komisen")}>
                <thead><tr>
                  <th>{L("Invoice", "Invois")}</th><th>{L("Customer", "Pelanggan")}</th><th>{L("Package", "Pakej")}</th><th>{L("Closer", "Penutup")}</th>
                  <th className={css.num}>{L("Sale", "Jualan")}</th><th>{L("Payment", "Bayaran")}</th><th>{L("Rate · policy", "Kadar · polisi")}</th>
                  <th className={css.num}>{L("Commission", "Komisen")}</th><th>{L("Eligible", "Layak")}</th><th>{L("Status", "Status")}</th><th>{L("Next step", "Langkah seterusnya")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={`l${e.id}`} onClick={() => setOpen(e.id)}>
                      <td><span className={css.strong}>{e.doc_number}</span>{e.kind === "reverse" ? ` · ${L("reversal", "pembalikan")}` : ""}{e.issuer_code ? <span className={css.sub}> · {e.issuer_code}</span> : null}</td>
                      <td className={css.wrapCell}>{e.company ?? "—"}</td><td className={css.wrapCell}>{e.package || "—"}</td><td>{e.closer_name ?? "—"}</td>
                      <td className={css.num}>{fmtRM(e.invoice_total)}</td><td>{payWord(e.payment_status)}</td>
                      <td>{e.kind === "earn" ? `${rateText(e)} · v${e.policy_version ?? "—"}` : "—"}</td>
                      <td className={`${css.num} ${css.strong}`}>{fmtRM(e.amount_cents)}</td><td>{dmy(e.eligible_at.slice(0, 10))}</td><td>{statusChip(e)}</td>
                      <td className={css.wrapCell}>{nextText(e.next)}</td>
                    </tr>
                  ))}
                  {ests.map((x) => (
                    <tr key={`e${x.invoice_id}`} className={css.estimate} onClick={() => setEst(x)}>
                      <td><span className={css.strong}>{x.doc_number}</span>{x.issuer_code ? <span className={css.sub}> · {x.issuer_code}</span> : null}</td>
                      <td className={css.wrapCell}>{x.company ?? "—"}</td><td className={css.wrapCell}>{x.package || "—"}</td><td>{x.closer_name ?? L("No closer", "Tiada penutup")}</td>
                      <td className={css.num}>{fmtRM(x.invoice_total)}</td><td>{x.stage === "part_paid" ? L(`Part paid · ${fmtRM(x.received_cents)}`, `Sebahagian · ${fmtRM(x.received_cents)}`) : payWord(x.payment_status)}</td>
                      <td>{x.policy_version ? `v${x.policy_version}` : L("No policy", "Tiada polisi")}</td>
                      <td className={css.num}>{x.estimate_cents === null ? "—" : fmtRM(x.estimate_cents)}</td><td>—</td>
                      <td><span className={chipNeutral}>{L(STAGE[x.stage][0], STAGE[x.stage][1])}</span></td>
                      <td className={css.wrapCell}>{nextText(x.next)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className={css.phone} aria-label={L("Commission entries", "Entri komisen")}>
              {rows.map((e) => (
                <li key={`l${e.id}`}><button type="button" onClick={() => setOpen(e.id)}>
                  <span className={css.cardTop}><span className={css.strong}>{e.doc_number}</span><strong>{fmtRM(e.amount_cents)}</strong></span>
                  <span className={css.facts}><span>{e.company ?? "—"}</span><span>{e.closer_name ?? "—"}</span><span>{fmtRM(e.invoice_total)}</span></span>
                  <span>{statusChip(e)}</span>
                  <span className={css.sub}>{L("Next", "Seterusnya")}: {nextText(e.next)}</span>
                </button></li>
              ))}
              {ests.map((x) => (
                <li key={`e${x.invoice_id}`}><button type="button" onClick={() => setEst(x)}>
                  <span className={css.cardTop}><span className={css.strong}>{x.doc_number}</span><strong>{x.estimate_cents === null ? "—" : fmtRM(x.estimate_cents)}</strong></span>
                  <span className={css.facts}><span>{x.company ?? "—"}</span><span>{x.closer_name ?? L("No closer", "Tiada penutup")}</span><span>{fmtRM(x.invoice_total)}</span></span>
                  <span><span className={chipNeutral}>{L(STAGE[x.stage][0], STAGE[x.stage][1])}</span></span>
                  <span className={css.sub}>{L("Next", "Seterusnya")}: {nextText(x.next)}</span>
                </button></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <EntryDrawer id={open} onClose={() => setOpen(null)} onSaved={onChanged} />
      <EstimateDrawer est={est} onClose={() => setEst(null)} />
    </TabZone>
  );
}

/* ------------------------------------------------------------------ */
/* Flow                                                                 */
interface FlowRow { key: string; n: number; cents: number; next: string }
interface FlowResp {
  start: string; sync: boolean; policy: Policy | null;
  invoices: FlowRow[]; entitlements: FlowRow[]; confirmed_total: { n: number; cents: number };
  exceptions: { review: { n: number; cents: number }; no_policy: number; no_closer: number; awaiting_confirmation: number; carried_forward: { n: number; cents: number }; leavers: { n: number; cents: number }; not_on_payslip?: { n: number; cents: number } };
}
/* v1.232.0 (audit F7/C6) - TWO ROWS, NEVER ADDED TOGETHER: open invoices
   by their one current stage (valued at the invoice total), and
   entitlements by their one status (valued at the commission). */
const INV_STAGES: Record<string, [string, string, string, string]> = {
  unpaid: ["Invoice issued", "Invois dikeluarkan", "Not paid yet - estimate only", "Belum dibayar - anggaran sahaja"],
  part_paid: ["Part paid", "Dibayar sebahagian", "Some money in - still estimate only", "Sebahagian diterima - masih anggaran"],
  awaiting_confirmation: ["Paid, awaiting CEO/COO", "Dibayar, menunggu CEO/COO", "Paid in full, not yet confirmed", "Dibayar penuh, belum disahkan"],
  policy_review: ["Confirmed, no policy", "Disahkan, tiada polisi", "Nothing is calculated until a version covers its day", "Tiada apa dikira sehingga versi meliputi harinya"],
};
const ENT_STATUS: Record<string, [string, string, string, string]> = {
  eligible: ["Eligible", "Layak", "Earned, not yet on a payslip", "Diperoleh, belum dalam slip gaji"],
  included: ["In payroll", "Dalam gaji", "On a payroll month, bank run not done", "Dalam bulan gaji, pembayaran bank belum selesai"],
  paid: ["Paid", "Dibayar", "The bank run is done", "Pembayaran bank selesai"],
  review: ["Under review", "Dalam semakan", "Held for the CEO's decision", "Ditahan untuk keputusan CEO"],
};
function FlowCards({ rows, words, label, money }: { rows: FlowRow[]; words: Record<string, [string, string, string, string]>; label: string; money: boolean }) {
  return (
    <ol className={`${css.stages} ${css.stages4}`} aria-label={label}>
      {rows.map((s, i) => {
        const t = words[s.key] ?? [s.key, s.key, "", ""];
        return (
          <li key={s.key} className={`${css.stage} ${money ? css.stageMoney : ""}`}>
            <span className={css.stageNo}>{i + 1}</span>
            <h4>{L(t[0], t[1])}</h4>
            <span className={css.stageFig}>{s.n}</span>
            <span className={css.sub}>{s.key === "policy_review" ? L(t[2], t[3]) : `${fmtRM(s.cents)} · ${L(t[2], t[3])}`}</span>
            {s.n > 0 && s.next !== "done" && <span className={css.stageNext}>{L("Next", "Seterusnya")}: {nextText(s.next)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
function Flow({ revision }: { revision: number }) {
  const [got, setGot] = useState<{ rev: number; d: FlowResp | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<FlowResp>(`/flow`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ rev: revision, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [revision]);
  const d = got?.rev === revision ? got.d : null;
  const x = d?.exceptions;
  const nos = x?.not_on_payslip;
  return (
    <>
      <TabZone label={L("Invoices", "Invois")} hint={d ? L(`Every open invoice, in its one current stage, valued at the invoice total. Confirmed Paid since ${dmy(d.start)}: ${d.confirmed_total.n} invoice(s), ${fmtRM(d.confirmed_total.cents)}.`, `Setiap invois terbuka, pada satu peringkat semasanya, dinilai pada jumlah invois. Disahkan Dibayar sejak ${dmy(d.start)}: ${d.confirmed_total.n} invois, ${fmtRM(d.confirmed_total.cents)}.`) : undefined}>
        {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : !d ? <div className={card}><SkelRows rows={3} /></div> : (
          <FlowCards rows={d.invoices} words={INV_STAGES} label={L("Invoices by stage", "Invois mengikut peringkat")} money={false} />
        )}
      </TabZone>
      <TabZone label={L("Commission entitlements", "Hak komisen")} hint={L("Every entitlement, in its one status, valued at the commission. Not added to the invoice row - one is sales value, the other is commission.", "Setiap hak, pada satu statusnya, dinilai pada komisen. Tidak dicampur dengan baris invois - satu nilai jualan, satu lagi komisen.")}>
        {!d ? (got?.e ? null : <div className={card}><SkelRows rows={3} /></div>) : (
          <FlowCards rows={d.entitlements} words={ENT_STATUS} label={L("Entitlements by status", "Hak mengikut status")} money />
        )}
      </TabZone>
      <TabZone label={L("Needs attention", "Perlu perhatian")} cols={2}>
        <div className={card}>
          {!x ? <SkelRows rows={4} /> : (
            <ul className={css.list}>
              <li><span className={css.listMain}><strong>{L("Under review", "Dalam semakan")}</strong><span>{L("No closer, a payment taken back after payroll, or a credit note", "Tiada penutup, bayaran ditarik balik selepas gaji, atau nota kredit")}</span></span><span className={x.review.n ? chipWarn : chipNeutral}>{x.review.n} · {fmtRM(x.review.cents)}</span></li>
              <li><span className={css.listMain}><strong>{L("Waiting for CEO/COO confirmation", "Menunggu pengesahan CEO/COO")}</strong><span>{L("Paid in full, not yet confirmed", "Dibayar penuh, belum disahkan")}</span></span><span className={x.awaiting_confirmation ? chipInfo : chipNeutral}>{x.awaiting_confirmation}</span></li>
              <li><span className={css.listMain}><strong>{L("Confirmed with no approved policy", "Disahkan tanpa polisi diluluskan")}</strong><span>{L("Nothing is calculated for these", "Tiada apa dikira untuk ini")}</span></span><span className={x.no_policy ? chipDanger : chipNeutral}>{x.no_policy}</span></li>
              <li><span className={css.listMain}><strong>{L("Invoices with no closer", "Invois tanpa penutup")}</strong><span>{L("Choose the closer on the invoice", "Pilih penutup pada invois")}</span></span><span className={x.no_closer ? chipWarn : chipNeutral}>{x.no_closer}</span></li>
              <li><span className={css.listMain}><strong>{L("Carried forward", "Dibawa ke hadapan")}</strong><span>{L("Eligible in an earlier month, waiting for the next open payroll", "Layak pada bulan lalu, menunggu gaji terbuka seterusnya")}</span></span><span className={chipNeutral}>{x.carried_forward.n} · {fmtRM(x.carried_forward.cents)}</span></li>
              <li><span className={css.listMain}><strong>{L("Leavers to settle", "Bekas staf untuk diselesaikan")}</strong><span>{L("Eligible after their last payroll - the CEO records the final settlement (Transactions)", "Layak selepas gaji terakhir mereka - CEO merekod penyelesaian akhir (Transaksi)")}</span></span><span className={x.leavers.n ? chipWarn : chipNeutral}>{x.leavers.n} · {fmtRM(x.leavers.cents)}</span></li>
              {nos && <li><span className={css.listMain}><strong>{L("In payroll, not on the payslip", "Dalam gaji, tiada dalam slip gaji")}</strong><span>{L("Payroll (HR) recomputes the month; the bank run holds these until the payslip carries them", "Gaji (HR) mengira semula bulan itu; pembayaran bank menahannya sehingga slip gaji membawanya")}</span></span><span className={nos.n ? chipDanger : chipNeutral}>{nos.n} · {fmtRM(nos.cents)}</span></li>}
            </ul>
          )}
        </div>
        <div className={card}>
          <p className={css.groupLabel}>{L("Controls", "Kawalan")}</p>
          <ul className={css.controls}>
            <li><strong>{L("Unpaid or part paid:", "Belum atau sebahagian dibayar:")}</strong>{L("estimate only, never payroll", "anggaran sahaja, tidak masuk gaji")}</li>
            <li><strong>{L("CCO:", "CCO:")}</strong>{L("reviews and monitors; cannot confirm Paid", "menyemak dan memantau; tidak boleh mengesahkan Dibayar")}</li>
            <li><strong>{L("Weekly target missed:", "Sasaran mingguan tidak dicapai:")}</strong>{L("does not touch earned commission", "tidak menjejaskan komisen yang diperoleh")}</li>
            <li><strong>{L("Refund or duplicate:", "Bayaran balik atau pendua:")}</strong>{L("a reversal for review; one entitlement per event", "pembalikan untuk semakan; satu hak bagi setiap peristiwa")}</li>
            <li><strong>{L("Payroll:", "Gaji:")}</strong>{d ? (d.sync ? L("switched on - eligible commission goes into the next open payroll", "dihidupkan - komisen layak masuk gaji terbuka seterusnya") : L("not yet switched on - entries are recorded, payroll ignores them", "belum dihidupkan - entri direkod, gaji tidak mengambilnya")) : "…"}</li>
          </ul>
        </div>
      </TabZone>
      {/* v1.227.0 - what must be true before commission is paid, as it
          stands now (the reference's "Activation requirements") */}
      <TabZone label={L("Before commission is paid", "Sebelum komisen dibayar")} hint={L("The five conditions, in the order a sale meets them, and where each stands today.", "Lima syarat, mengikut urutan jualan menempuhnya, dan kedudukan setiap satu hari ini.")}>
        <div className={card}>
          {!d || !x ? <SkelRows rows={5} /> : (
            <ol className={css.checks} aria-label={L("Conditions", "Syarat")}>
              {([
                [L("A verified closer on every invoice", "Penutup disahkan pada setiap invois"), x.no_closer === 0, x.no_closer === 0 ? L("Every invoice names its closer", "Setiap invois menamakan penutupnya") : L(`${x.no_closer} invoice(s) without a closer`, `${x.no_closer} invois tanpa penutup`)],
                [L("Payment confirmed by the CEO or COO", "Bayaran disahkan oleh CEO atau COO"), x.awaiting_confirmation === 0, x.awaiting_confirmation === 0 ? L("Nothing waiting", "Tiada yang menunggu") : L(`${x.awaiting_confirmation} paid invoice(s) waiting`, `${x.awaiting_confirmation} invois dibayar menunggu`)],
                [L("An approved policy version", "Versi polisi diluluskan"), !!d.policy, d.policy ? `v${d.policy.version} · ${rateText(d.policy)} · ${L("from", "mulai")} ${dmy(d.policy.effective_from)}` : L("No version approved - nothing is calculated", "Tiada versi diluluskan - tiada apa dikira")],
                [L("One entitlement per payment", "Satu hak bagi setiap bayaran"), true, L("Always enforced: one ledger row per confirmation", "Sentiasa dikuatkuasa: satu baris lejar bagi setiap pengesahan")],
                [L("Payroll link", "Pautan gaji"), d.sync, d.sync ? L("On - eligible commission goes into the next open payroll", "Hidup - komisen layak masuk gaji terbuka seterusnya") : L("Off - recorded only until the CEO switches it on", "Mati - direkod sahaja sehingga CEO menghidupkannya")],
              ] as [string, boolean, string][]).map(([t, okay, sub], i) => (
                <li key={t}>
                  <span className={css.checkNo}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={css.listMain}><strong>{t}</strong><span>{sub}</span></span>
                  <span className={okay ? chipSuccess : chipWarn}>{okay ? L("Ready", "Sedia") : L("Not yet", "Belum")}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </TabZone>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Policy                                                               */
interface PkgRule { package_name: string; match_key: string; rule: "percent" | "fixed" | "none"; rate_bp: number | null; fixed_cents: number | null }
type PolicyP = Policy & { packages?: PkgRule[]; product_rule?: string | null };
interface Suggest { from_invoices: { name: string; n: number; last_price_cents: number | null; last_on: string }[]; rate_card: string[]; library?: { id: number; name: string; status: string; current_version: number }[] }
/* v1.232.0 - a rule naming a library package covers every line of an invoice made from it */
const libId = (r: { match_key: string }) => r.match_key.startsWith("pkg:") ? Number(r.match_key.slice(4)) || null : null;
const pkgLabel = (r: PkgRule) => libId(r) ? L(`${r.package_name} (library package)`, `${r.package_name} (pakej pustaka)`) : r.package_name;
const keyOf = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
const pkgRuleText = (r: Pick<PkgRule, "rule" | "rate_bp" | "fixed_cents">) => r.rule === "none" ? L("No commission", "Tiada komisen") : r.rule === "fixed" ? L(`${fmtRM(r.fixed_cents ?? 0)} per unit`, `${fmtRM(r.fixed_cents ?? 0)} seunit`) : `${((r.rate_bp ?? 0) / 100).toFixed(2)}%`;
const pkgOn = (r: PkgRule | null, p: Policy, price: number) => r ? (r.rule === "none" ? 0 : r.rule === "fixed" ? (r.fixed_cents ?? 0) : Math.floor((price * (r.rate_bp ?? 0) + 5000) / 10000))
  : p.rate_kind === "fixed" ? (p.fixed_cents ?? 0) : Math.floor((price * (p.rate_bp ?? 0) + 5000) / 10000);
interface PolicyResp { versions: PolicyP[]; log: { setting: string; value: string; reason: string; changed_at: string; changed_by_name: string | null }[]; in_force: PolicyP | null; sync: boolean; start: string; today: string; can_draft: boolean; can_approve: boolean; can_switch: boolean; pending_migration?: boolean }
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
  const [form, setForm] = useState<{ name: string; from: string; kind: "percent" | "fixed"; rate: string; fixed: string; basis: "net_of_tax_delivery" | "invoice_total"; reason: string; packages: PkgForm[] } | null>(null);
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
    const r = await api<{ version: number }>(`/policy`, { method: "POST", body: JSON.stringify({ name: form.name, effective_from: form.from, rate_kind: form.kind, rate_pct: Number(form.rate), fixed_cents: Math.round(Number(form.fixed) * 100), basis: form.basis, reason: form.reason, packages }) });
    setBusy(false);
    if (r.ok) { setForm(null); done(L("Draft saved", "Draf disimpan"), r.data?.version ? L(`Version ${r.data.version} waits for the CEO's approval`, `Versi ${r.data.version} menunggu kelulusan CEO`) : L("It waits for the CEO's approval", "Ia menunggu kelulusan CEO")); } else setError(message(r));
  };
  const approve = async (p: PolicyP) => {
    const pk = p.packages?.length ? `\n${L("Package rules", "Peraturan pakej")}: ${p.packages.map((x) => `${pkgLabel(x)} ${pkgRuleText(x)}`).join(" · ")}` : "";
    if (!(await confirm({ title: L(`Approve version ${p.version}?`, `Luluskan versi ${p.version}?`), message: `${p.name}\n${rateText(p)} · ${basisText(p.basis)}${pk}\n${L("From", "Mulai")} ${dmy(p.effective_from)}`, confirmLabel: L("Approve policy", "Luluskan polisi") }))) return;
    const r = await api(`/policy/${p.id}/approve`, { method: "POST", body: JSON.stringify({ confirm: true }) });
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
  const draft = d?.versions.find((v) => v.status === "draft") ?? null;
  const priceOf = (name: string) => sug?.from_invoices.find((x) => keyOf(x.name) === keyOf(name))?.last_price_cents ?? null;
  /* the example table: the version's package rules, or - with none - the
     lines most used on recent invoices, each at its real latest price */
  const examples: { name: string; rule: PkgRule | null; price: number | null }[] = p
    ? (p.packages?.length ? p.packages.map((r) => ({ name: r.package_name, rule: r, price: priceOf(r.package_name) }))
      : (sug?.from_invoices ?? []).filter((x) => x.last_price_cents !== null).slice(0, 5).map((x) => ({ name: x.name, rule: null, price: x.last_price_cents })))
    : [];
  const pkgValid = (x: PkgForm) => (!x.pkgId && !x.name.trim()) || x.rule === "none" || (x.rule === "percent" ? Number(x.value) >= 0 && Number(x.value) <= 50 && x.value !== "" : Number(x.value) > 0);
  return (
    <>
      {toastNode}{confirmNode}{askNode}
      {loadErr ? <p role="alert" className={css.error}>{loadErr}</p> : null}
      <TabZone label={L("Policy at a glance", "Polisi sepintas lalu")}>
        {!d ? <KpiRow label={L("Policy at a glance", "Polisi sepintas lalu")}><SkelStat /><SkelStat /><SkelStat /><SkelStat /></KpiRow> : (
          <KpiRow label={L("Policy at a glance", "Polisi sepintas lalu")}>
            <KpiTile icon="balance" tone="navy" label={L("Default rate", "Kadar asas")} value={p ? rateText(p) : "—"} sub={p ? (p.packages?.length ? L(`${p.packages.length} package rule(s)`, `${p.packages.length} peraturan pakej`) : L("Every line, one rate", "Setiap baris, satu kadar")) : L("No version approved", "Tiada versi diluluskan")} />
            <KpiTile icon="verify" tone="gold" label={L("Policy status", "Status polisi")} value={p ? L(`In force · v${p.version}`, `Berkuat kuasa · v${p.version}`) : draft ? L("Draft", "Draf") : L("None", "Tiada")} sub={p ? L(`From ${dmy(p.effective_from)}`, `Mulai ${dmy(p.effective_from)}`) : draft ? L("Waiting for the CEO's approval", "Menunggu kelulusan CEO") : L("Draft a version below", "Draf versi di bawah")} />
            <KpiTile icon="paid" tone="blue" label={L("Invoice paid confirmed by", "Bayaran invois disahkan oleh")} value={L("CEO / COO", "CEO / COO")} sub={L("CCO reviews and monitors only", "CCO menyemak dan memantau sahaja")} />
            <KpiTile icon="target" tone="green" label={L("Weekly sales targets", "Sasaran jualan mingguan")} value={L("Separate", "Berasingan")} sub={L("No effect on commission", "Tiada kesan pada komisen")} />
          </KpiRow>
        )}
      </TabZone>
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
                <div><dt>{L("Eligibility", "Kelayakan")}</dt><dd>{L("Invoice paid in full and confirmed by the CEO or COO", "Invois dibayar penuh dan disahkan CEO atau COO")}</dd></div>
                <div><dt>{L("Closer", "Penutup")}</dt><dd>{L("The salesperson the invoice names, locked at the first payment; corrected only by the CEO, with a reason", "Jurujual yang dinamakan invois, dikunci pada bayaran pertama; dibetulkan oleh CEO sahaja, dengan sebab")}</dd></div>
                <div><dt>{L("Partial payment", "Bayaran sebahagian")}</dt><dd>{L("Estimate only - the whole invoice earns once it is paid in full", "Anggaran sahaja - keseluruhan invois memperoleh apabila dibayar penuh")}</dd></div>
                <div><dt>{L("Products", "Produk")}</dt><dd>{L("Services earn the default rate; a product earns only if a package rule lists it", "Servis memperoleh kadar asas; produk memperoleh hanya jika peraturan pakej menyenaraikannya")}</dd></div>
                <div><dt>{L("Leavers", "Bekas staf")}</dt><dd>{L("Their final payroll, or recorded by the CEO as paid in the final settlement", "Gaji terakhir mereka, atau direkod CEO sebagai dibayar dalam penyelesaian akhir")}</dd></div>
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
            <div><dt>{L("Drafts", "Draf")}</dt><dd>{L("The CEO, COO or super admin, with a reason", "CEO, COO atau super admin, dengan sebab")}</dd></div>
            <div><dt>{L("Approval", "Kelulusan")}</dt><dd>{L("The CEO (or super admin) only", "CEO (atau super admin) sahaja")}</dd></div>
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

      <TabZone label={L("Versions", "Versi")} hint={L("Drafts, approvals and rejections, newest first. A preview applies a version to the last 60 days of confirmed invoices and writes nothing.", "Draf, kelulusan dan penolakan, terbaru dahulu. Pratonton menggunakan versi pada 60 hari invois disahkan dan tidak menulis apa-apa.")}>
        <div className={card}>
          {!d ? <SkelRows rows={3} /> : (
            <div className={css.body}>
              {d.can_draft && !form && <div className={css.formRow}><button type="button" className={btnSmPrimary} onClick={() => setForm({ name: p ? `${p.name}` : L("A2Z Sales Commission", "Komisen Jualan A2Z"), from: floor, kind: p?.rate_kind ?? "percent", rate: p?.rate_bp ? String(p.rate_bp / 100) : "", fixed: p?.fixed_cents ? String(p.fixed_cents / 100) : "", basis: p?.basis ?? "net_of_tax_delivery", reason: "", packages: (p?.packages ?? []).map((x) => ({ name: x.package_name, pkgId: libId(x), rule: x.rule, value: x.rule === "percent" ? String((x.rate_bp ?? 0) / 100) : x.rule === "fixed" ? String((x.fixed_cents ?? 0) / 100) : "" })) })}><AppIcon name="add" />{L("Draft a new version", "Draf versi baharu")}</button></div>}
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
                  <label>{L("Reason for this version", "Sebab versi ini")}<textarea aria-label={L("Policy reason", "Sebab polisi")} className={inputClass} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                  <p className={css.sub}>{L("Every version carries the approved fixed rules: the whole invoice paid and confirmed, every paid renewal, refunds to review, the payroll cutoff, leavers (final payroll or settlement) and products (listed only). Changing one needs the owner's approval first.", "Setiap versi membawa peraturan tetap yang diluluskan: keseluruhan invois dibayar dan disahkan, setiap pembaharuan dibayar, bayaran balik untuk semakan, potongan gaji, bekas staf (gaji terakhir atau penyelesaian) dan produk (disenaraikan sahaja). Mengubahnya memerlukan kelulusan pemilik dahulu.")}</p>
                  <div className={css.formRow}>
                    <button type="button" className={btnClass} disabled={form.name.trim().length < 3 || form.reason.trim().length < 10 || (form.kind === "percent" ? !(Number(form.rate) > 0) : !(Number(form.fixed) > 0)) || !form.packages.every(pkgValid)} onClick={() => void saveDraft()}><AppIcon name="save" />{L("Save draft", "Simpan draf")}</button>
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
  "invoice.paid_confirm": ["Payment confirmed", "Bayaran disahkan"], "invoice.paid_confirm_revoke": ["Confirmation taken back", "Pengesahan ditarik balik"],
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
function AuditView({ revision }: { revision: number }) {
  const [got, setGot] = useState<{ rev: number; d: { events: { id: number; action: string; detail: string | null; created_at: string; who: string | null }[] } | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<{ events: { id: number; action: string; detail: string | null; created_at: string; who: string | null }[] }>(`/audit`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ rev: revision, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [revision]);
  const d = got?.rev === revision ? got.d : null;
  return (
    <TabZone label={L("Audit history", "Sejarah audit")} hint={L("Policy drafts and approvals, the payroll switch, payment confirmations, closer corrections and review decisions - who, when and why. Nothing here can be edited.", "Draf dan kelulusan polisi, suis gaji, pengesahan bayaran, pembetulan penutup dan keputusan semakan - siapa, bila dan mengapa. Tiada apa boleh diubah.")}>
      <div className={card}>
        {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : !d ? <SkelRows rows={6} /> : d.events.length === 0 ? <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
          <ul className={css.list}>{d.events.map((x) => (
            <li key={x.id}><span className={css.listMain}><strong>{ACTIONS[x.action] ? L(ACTIONS[x.action]![0], ACTIONS[x.action]![1]) : x.action} · {x.who ?? "—"}</strong><span>{dmyMYT(x.created_at)}{detailLine(x.detail) ? ` · ${detailLine(x.detail)}` : ""}</span></span></li>
          ))}</ul>
        )}
      </div>
    </TabZone>
  );
}

/* ------------------------------------------------------------------ */
export function CommissionPanel({ user }: { user: { id: number; role: string } }) {
  const all = VIEW_ALL.includes(user.role);
  const [view, setView] = useState<View>(all ? "overview" : "transactions");
  const [seen, setSeen] = useState<Record<View, boolean>>({ overview: all, transactions: !all, policy: false, payroll: false, audit: false });
  const [scope, setScope] = useState<WsScope>(all ? "all" : "mine");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const open = (v: View) => { setView(v); setSeen((x) => ({ ...x, [v]: true })); };
  const sKey = `${scope}|${revision}`;
  const [sum, setSum] = useState<{ k: string; d: Summary | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<Summary>(`/summary?scope=${sKey.split("|")[0]}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setSum({ k: sKey, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [sKey]);
  const s = sum?.k === sKey ? sum.d : null;
  const tabs = all
    ? ([["overview", L("Overview", "Gambaran")], ["transactions", L("Transactions", "Transaksi")], ["policy", L("Policy Settings", "Tetapan Polisi")], ["payroll", L("Payroll Sync", "Penyegerakan Gaji")], ["audit", L("Audit History", "Sejarah Audit")]] as const)
    : ([["transactions", L("My commission", "Komisen saya")]] as const);
  const figures = (
    <TabZone label={all && scope === "all" ? L("The team at a glance", "Pasukan sepintas lalu") : L("Mine at a glance", "Milik saya sepintas lalu")}>
      {!s && !sum?.e ? <KpiRow label={L("Commission at a glance", "Ringkasan komisen")}><SkelStat /><SkelStat /><SkelStat /><SkelStat /></KpiRow> : <KpiRow label={L("Commission at a glance", "Ringkasan komisen")}>
        <KpiTile icon="pending" tone="navy" busy={!s} label={L("Estimated", "Anggaran")} value={fmtRM(s?.estimated.cents ?? 0)} sub={s ? L(`${s.estimated.n} open invoice(s) - not earned yet`, `${s.estimated.n} invois terbuka - belum diperoleh`) : undefined} />
        <KpiTile icon="verify" tone="gold" busy={!s} label={L("Eligible", "Layak")} value={fmtRM(s?.eligible.cents ?? 0)} sub={s ? (s.review.n ? L(`${s.eligible.n} entr(ies) · ${s.review.n} under review`, `${s.eligible.n} entri · ${s.review.n} dalam semakan`) : L(`${s.eligible.n} entr(ies) waiting for payroll`, `${s.eligible.n} entri menunggu gaji`)) : undefined} />
        <KpiTile icon="money" tone="blue" busy={!s} label={L("Included in payroll", "Dalam gaji")} value={fmtRM(s?.included.cents ?? 0)} sub={s ? (s.sync ? L(`${s.included.n} entr(ies), bank run not yet done`, `${s.included.n} entri, pembayaran bank belum selesai`) : L("Payroll link not switched on yet", "Pautan gaji belum dihidupkan")) : undefined} />
        <KpiTile icon="paid" tone="green" busy={!s} label={L("Commission paid", "Komisen dibayar")} value={fmtRM(s?.paid.cents ?? 0)} sub={s ? L(`${ym(s.month)} payroll · ${s.paid.n} entr(ies)`, `Gaji ${ym(s.month)} · ${s.paid.n} entri`) : undefined} />
      </KpiRow>}
    </TabZone>
  );
  return (
    <TabPage>
      <LineTabs value={view} onChange={open} tabs={tabs} label={L("Commission", "Komisen")}
        aside={<TabAside>{all && (view === "transactions" || view === "overview") && <ScopeSwitch scope={scope} onChange={setScope} />}<button type="button" className={btnSm} title={L("Refresh", "Muat semula")} aria-label={L("Refresh commission", "Muat semula komisen")} onClick={reload}><AppIcon name="refresh" /></button></TabAside>} />
      {sum?.e && <p role="alert" className={css.error}>{sum.e}</p>}
      {s && !s.policy && view !== "audit" && <p className={`${css.note} ${css.warnNote}`}>{L("No commission policy is approved yet - nothing is estimated or earned until the CEO approves one (Policy Settings).", "Tiada polisi komisen diluluskan lagi - tiada apa dianggar atau diperoleh sehingga CEO meluluskannya (Tetapan Polisi).")}</p>}
      {all && <div className={css.body} hidden={view !== "overview"}>{seen.overview && <>{figures}<Flow revision={revision} /></>}</div>}
      <div className={css.body} hidden={view !== "transactions"}>{seen.transactions && <>{figures}<Entries scope={all ? scope : "mine"} revision={revision} onChanged={reload} /></>}</div>
      {all && <div className={css.body} hidden={view !== "policy"}>{seen.policy && <PolicyView revision={revision} onChanged={reload} />}</div>}
      {all && <div className={css.body} hidden={view !== "payroll"}>{seen.payroll && <PayrollView revision={revision} onChanged={reload} summary={s} />}</div>}
      {all && <div className={css.body} hidden={view !== "audit"}>{seen.audit && <AuditView revision={revision} />}</div>}
    </TabPage>
  );
}
