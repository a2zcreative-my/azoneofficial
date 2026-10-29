"use client";

/* v1.224.0 - THE COMMISSION TAB, back (the owner's Commission brief and
   answers, 29-10-2026; claude/COMMISSION-AUDIT.md). Three views, never one
   page: Entries (what each sale earned, or may), Flow (where every invoice
   and entitlement stands, the seven stages) and Policy (the versioned rule,
   its approval and the payroll switch). Every figure comes from
   /staff/commission/* (worker/src/commission.ts) - nothing is calculated,
   invented or paid from here. A consultant sees their own entries only; the
   CCO reads everything and changes nothing. */

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
}
interface Estimate {
  invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; user_id: number | null; invoice_total: number; payment_status: string | null;
  received_cents: number; stage: "unpaid" | "part_paid" | "awaiting_confirmation"; package: string; created_at: string;
  estimate_cents: number | null; basis_cents: number | null; policy_version: number | null;
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

type View = "entries" | "flow" | "policy";
type Filter = "" | "estimated" | Entry["status"];

/* ------------------------------------------------------------------ */
/* One entry: every fact, every step, the review                        */
function EntryDrawer({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ id: number; d: { entry: Entry & { tax_percent: number; discount_cents: number; delivery_cents: number; policy_name: string | null; policy_basis: string | null }; related: { id: number; kind: string; status: string; amount_cents: number; payroll_month: string | null; note: string | null; created_at: string }[]; confirmations: { id: number; amount_cents: number; payment_ref: string | null; confirmed_at: string; confirmed_by_name: string | null; revoked_at: string | null; revoke_reason: string | null; revoked_by_name: string | null }[]; history: { action: string; detail: string | null; created_at: string; who: string | null }[]; can_decide: boolean } | null; e: string } | null>(null);
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
  const decide = async (decision: "apply" | "dismiss" | "settled") => {
    if (!e) return;
    setBusy(true); setError("");
    const r = await api<{ status: string }>(`/ledger/${e.id}/decide`, { method: "POST", body: JSON.stringify({ decision, note }) });
    setBusy(false);
    if (r.ok) { toast(L("Decision recorded", "Keputusan direkod"), decision === "apply" ? L("Applied", "Dilaksanakan") : L("Closed, with your reason", "Ditutup, dengan sebab anda")); setNote(""); setTick((t) => t + 1); onSaved(); }
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
          </dl>
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
                  <th className={css.num}>{L("Commission", "Komisen")}</th><th>{L("Eligible", "Layak")}</th><th>{L("Status", "Status")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={`l${e.id}`} onClick={() => setOpen(e.id)}>
                      <td><span className={css.strong}>{e.doc_number}</span>{e.kind === "reverse" ? ` · ${L("reversal", "pembalikan")}` : ""}</td>
                      <td className={css.wrapCell}>{e.company ?? "—"}</td><td className={css.wrapCell}>{e.package || "—"}</td><td>{e.closer_name ?? "—"}</td>
                      <td className={css.num}>{fmtRM(e.invoice_total)}</td><td>{payWord(e.payment_status)}</td>
                      <td>{e.kind === "earn" ? `${rateText(e)} · v${e.policy_version ?? "—"}` : "—"}</td>
                      <td className={`${css.num} ${css.strong}`}>{fmtRM(e.amount_cents)}</td><td>{dmy(e.eligible_at.slice(0, 10))}</td><td>{statusChip(e)}</td>
                    </tr>
                  ))}
                  {ests.map((x) => (
                    <tr key={`e${x.invoice_id}`} className={css.estimate} onClick={() => setEst(x)}>
                      <td><span className={css.strong}>{x.doc_number}</span></td>
                      <td className={css.wrapCell}>{x.company ?? "—"}</td><td className={css.wrapCell}>{x.package || "—"}</td><td>{x.closer_name ?? L("No closer", "Tiada penutup")}</td>
                      <td className={css.num}>{fmtRM(x.invoice_total)}</td><td>{x.stage === "part_paid" ? L(`Part paid · ${fmtRM(x.received_cents)}`, `Sebahagian · ${fmtRM(x.received_cents)}`) : payWord(x.payment_status)}</td>
                      <td>{x.policy_version ? `v${x.policy_version}` : L("No policy", "Tiada polisi")}</td>
                      <td className={css.num}>{x.estimate_cents === null ? "—" : fmtRM(x.estimate_cents)}</td><td>—</td>
                      <td><span className={chipNeutral}>{L(STAGE[x.stage][0], STAGE[x.stage][1])}</span></td>
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
                </button></li>
              ))}
              {ests.map((x) => (
                <li key={`e${x.invoice_id}`}><button type="button" onClick={() => setEst(x)}>
                  <span className={css.cardTop}><span className={css.strong}>{x.doc_number}</span><strong>{x.estimate_cents === null ? "—" : fmtRM(x.estimate_cents)}</strong></span>
                  <span className={css.facts}><span>{x.company ?? "—"}</span><span>{x.closer_name ?? L("No closer", "Tiada penutup")}</span><span>{fmtRM(x.invoice_total)}</span></span>
                  <span><span className={chipNeutral}>{L(STAGE[x.stage][0], STAGE[x.stage][1])}</span></span>
                </button></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <EntryDrawer id={open} onClose={() => setOpen(null)} onSaved={onChanged} />
      <SideDrawer open={est !== null} onClose={() => setEst(null)} title={est ? `${est.doc_number} · ${L("Estimate", "Anggaran")}` : ""} subtitle={est ? `${est.company ?? "—"} · ${est.closer_name ?? L("No closer", "Tiada penutup")}` : undefined}>
        {est && (
          <div className={css.body}>
            <dl className={css.dl}>
              <dt>{L("Invoice", "Invois")}</dt><dd>{est.doc_number} · {fmtRM(est.invoice_total)}</dd>
              <dt>{L("Package or service", "Pakej atau servis")}</dt><dd>{est.package || "—"}</dd>
              <dt>{L("Payment", "Bayaran")}</dt><dd>{est.stage === "part_paid" ? L(`Part paid · ${fmtRM(est.received_cents)} received`, `Dibayar sebahagian · ${fmtRM(est.received_cents)} diterima`) : payWord(est.payment_status)}</dd>
              <dt>{L("Basis", "Asas")}</dt><dd>{est.basis_cents === null ? "—" : fmtRM(est.basis_cents)}</dd>
              <dt>{L("Estimated commission", "Anggaran komisen")}</dt><dd><strong>{est.estimate_cents === null ? L("No approved policy", "Tiada polisi diluluskan") : fmtRM(est.estimate_cents)}</strong></dd>
            </dl>
            <p className={css.note}>{est.stage === "awaiting_confirmation"
              ? L("Paid in full. It becomes eligible when the CEO or COO confirms the payment on Sales -> Closed Sales.", "Dibayar penuh. Ia menjadi layak apabila CEO atau COO mengesahkan bayaran di Jualan -> Jualan Ditutup.")
              : L("An estimate only - it earns nothing until the invoice is paid in full and the CEO or COO confirms it. A part payment never earns on its own.", "Anggaran sahaja - tiada apa diperoleh sehingga invois dibayar penuh dan disahkan CEO atau COO. Bayaran sebahagian tidak memperoleh apa-apa.")}</p>
          </div>
        )}
      </SideDrawer>
    </TabZone>
  );
}

/* ------------------------------------------------------------------ */
/* Flow                                                                 */
interface FlowResp {
  start: string; sync: boolean; policy: Policy | null;
  stages: { key: string; n: number; cents: number }[];
  exceptions: { review: { n: number; cents: number }; no_policy: number; no_closer: number; awaiting_confirmation: number; carried_forward: { n: number; cents: number }; leavers: { n: number; cents: number } };
}
const STAGES: Record<string, [string, string, string, string, boolean]> = {
  closed: ["Deal closed", "Jualan ditutup", "Invoices with a verified closer", "Invois dengan penutup disahkan", false],
  issued: ["Invoice issued", "Invois dikeluarkan", "Not paid yet - estimate only", "Belum dibayar - anggaran sahaja", false],
  verified: ["Payment verified", "Bayaran disemak", "Part paid, or paid and waiting for the CEO/COO", "Dibayar sebahagian, atau dibayar dan menunggu CEO/COO", false],
  confirmed: ["CEO / COO: Paid", "CEO / COO: Dibayar", "Confirmed by management - the CCO cannot", "Disahkan pengurusan - CCO tidak boleh", false],
  eligible: ["Commission eligible", "Komisen layak", "The approved rate on the eligible sale value", "Kadar diluluskan atas nilai jualan layak", true],
  included: ["Payroll included", "Dimasukkan dalam gaji", "The right person, the right month, once", "Orang yang betul, bulan yang betul, sekali", true],
  paid: ["Commission paid", "Komisen dibayar", "After the bank run is done", "Selepas pembayaran bank selesai", true],
};
function Flow({ revision }: { revision: number }) {
  const [got, setGot] = useState<{ rev: number; d: FlowResp | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<FlowResp>(`/flow`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ rev: revision, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [revision]);
  const d = got?.rev === revision ? got.d : null;
  const x = d?.exceptions;
  return (
    <>
      <TabZone label={L("Approval to payroll", "Kelulusan ke gaji")} hint={L("Where every invoice and every entitlement stands now. Counts and amounts are live records; stages 1-4 count invoices, 5-7 count commission.", "Kedudukan setiap invois dan hak sekarang. Bilangan dan jumlah ialah rekod langsung; peringkat 1-4 mengira invois, 5-7 mengira komisen.")}>
        {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : !d ? <div className={card}><SkelRows rows={4} /></div> : (
          <ol className={css.stages} aria-label={L("Commission stages", "Peringkat komisen")}>
            {d.stages.map((s, i) => {
              const t = STAGES[s.key]!;
              return (
                <li key={s.key} className={`${css.stage} ${t[4] ? css.stageMoney : ""}`}>
                  <span className={css.stageNo}>{String(i + 1).padStart(2, "0")}</span>
                  <h4>{L(t[0], t[1])}</h4>
                  <span className={css.stageFig}>{s.n}</span>
                  <span className={css.sub}>{fmtRM(s.cents)} · {L(t[2], t[3])}</span>
                </li>
              );
            })}
          </ol>
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
              <li><span className={css.listMain}><strong>{L("Leavers to settle", "Bekas staf untuk diselesaikan")}</strong><span>{L("Eligible after their last payroll - the CEO decides", "Layak selepas gaji terakhir mereka - CEO memutuskan")}</span></span><span className={x.leavers.n ? chipWarn : chipNeutral}>{x.leavers.n} · {fmtRM(x.leavers.cents)}</span></li>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Policy                                                               */
interface PolicyResp { versions: Policy[]; log: { setting: string; value: string; reason: string; changed_at: string; changed_by_name: string | null }[]; in_force: Policy | null; sync: boolean; start: string; today: string; can_draft: boolean; can_approve: boolean; can_switch: boolean; pending_migration?: boolean }
interface PreviewResp { policy: Policy; rows: { invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; package: string; paid_day: string; basis_cents: number; amount_cents: number; current_version: number | null; current_cents: number | null }[]; total_cents: number }
function PolicyView({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ k: string; d: PolicyResp | null; e: string } | null>(null);
  const key = `${revision}|${tick}`;
  useEffect(() => {
    const c = new AbortController();
    void api<PolicyResp>(`/policy`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ k: key, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [key]);
  const d = got?.k === key ? got.d : got?.d ?? null;
  const [form, setForm] = useState<{ name: string; from: string; kind: "percent" | "fixed"; rate: string; fixed: string; basis: "net_of_tax_delivery" | "invoice_total"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: number; d: PreviewResp | null; e: string } | null>(null);
  const [switchReason, setSwitchReason] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt: ask, node: askNode } = usePrompt();
  const done = (t: string, s: string) => { toast(t, s); setTick((x) => x + 1); onChanged(); };
  const saveDraft = async () => {
    if (!form) return;
    setBusy(true); setError("");
    const r = await api<{ version: number }>(`/policy`, { method: "POST", body: JSON.stringify({ name: form.name, effective_from: form.from, rate_kind: form.kind, rate_pct: Number(form.rate), fixed_cents: Math.round(Number(form.fixed) * 100), basis: form.basis, reason: form.reason }) });
    setBusy(false);
    if (r.ok) { setForm(null); done(L("Draft saved", "Draf disimpan"), L(`Version ${r.data?.version} waits for the CEO's approval`, `Versi ${r.data?.version} menunggu kelulusan CEO`)); } else setError(message(r));
  };
  const approve = async (p: Policy) => {
    if (!(await confirm({ title: L(`Approve version ${p.version}?`, `Luluskan versi ${p.version}?`), message: `${p.name}\n${rateText(p)} · ${basisText(p.basis)}\n${L("From", "Mulai")} ${dmy(p.effective_from)}`, confirmLabel: L("Approve policy", "Luluskan polisi") }))) return;
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
  const flip = async (on: boolean) => {
    if (!(await confirm({ title: on ? L("Switch commission into payroll?", "Hidupkan komisen ke dalam gaji?") : L("Switch commission out of payroll?", "Matikan komisen daripada gaji?"), message: on ? L("Eligible commission will be given to the next open payroll month, once. Released months are never changed.", "Komisen layak akan dimasukkan ke bulan gaji terbuka seterusnya, sekali. Bulan yang dikeluarkan tidak diubah.") : L("Payroll stops taking new commission. What a month already holds stays until you recompute it.", "Gaji berhenti mengambil komisen baharu."), confirmLabel: on ? L("Switch on", "Hidupkan") : L("Switch off", "Matikan") }))) return;
    const r = await api(`/settings`, { method: "POST", body: JSON.stringify({ sync: on ? "on" : "off", reason: switchReason }) });
    if (r.ok) { setSwitchReason(""); done(on ? L("Payroll switched on", "Gaji dihidupkan") : L("Payroll switched off", "Gaji dimatikan"), L("Logged with your reason", "Direkod dengan sebab anda")); } else setError(message(r));
  };
  const p = d?.in_force ?? null;
  const floor = d ? (d.today > d.start ? d.today : d.start) : mytToday();
  return (
    <>
      {toastNode}{confirmNode}{askNode}
      {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : null}
      <TabZone label={L("Policy in force", "Polisi berkuat kuasa")} cols={2}>
        <div className={card}>
          {!d ? <SkelRows rows={7} /> : !p ? (
            <>
              <p className={css.empty}>{L("No commission policy is approved yet. Nothing is calculated until one is.", "Tiada polisi komisen diluluskan lagi. Tiada apa dikira sehingga ada.")}</p>
              <p className={css.sub}>{L(`The first payroll that can carry commission is ${ym(d.start.slice(0, 7))}; only money that lands from ${dmy(d.start)} counts.`, `Gaji pertama yang boleh membawa komisen ialah ${ym(d.start.slice(0, 7))}; hanya wang yang diterima dari ${dmy(d.start)} dikira.`)}</p>
            </>
          ) : (
            <>
              <div className={css.head}><h3>{p.name}</h3><span className={chipSuccess}>{L("Active", "Aktif")} · v{p.version}</span></div>
              <dl className={css.terms}>
                <div><dt>{L("Rate", "Kadar")}</dt><dd>{rateText(p)}</dd></div>
                <div><dt>{L("Calculation basis", "Asas pengiraan")}</dt><dd>{basisText(p.basis)}</dd></div>
                <div><dt>{L("Eligibility", "Kelayakan")}</dt><dd>{L("Invoice paid in full and confirmed by the CEO or COO", "Invois dibayar penuh dan disahkan CEO atau COO")}</dd></div>
                <div><dt>{L("Closer", "Penutup")}</dt><dd>{L("The salesperson on the invoice, locked at the first payment", "Jurujual pada invois, dikunci pada bayaran pertama")}</dd></div>
                <div><dt>{L("Partial payment", "Bayaran sebahagian")}</dt><dd>{L("Estimate only", "Anggaran sahaja")}</dd></div>
                <div><dt>{L("LIVE packages and renewals", "Pakej LIVE dan pembaharuan")}</dt><dd>{L("Same rate; every paid monthly invoice earns for its closer", "Kadar sama; setiap invois bulanan dibayar memperoleh untuk penutupnya")}</dd></div>
                <div><dt>{L("Refunds", "Bayaran balik")}</dt><dd>{L("A reversal for the CEO's review; never deducted from paid wages", "Pembalikan untuk semakan CEO; tidak dipotong daripada gaji yang dibayar")}</dd></div>
                <div><dt>{L("Payroll", "Gaji")}</dt><dd>{L("Confirmed by a month's last day -> that month, if not yet released; otherwise the next open month", "Disahkan sebelum hari terakhir bulan -> bulan itu, jika belum dikeluarkan; jika tidak, bulan terbuka seterusnya")}</dd></div>
                <div><dt>{L("In force from", "Berkuat kuasa mulai")}</dt><dd>{dmy(p.effective_from)} · {L("by the day the money landed", "mengikut hari wang diterima")}</dd></div>
              </dl>
            </>
          )}
        </div>
        <div className={card}>
          <div className={css.head}><h3>{L("Governance", "Tadbir urus")}</h3></div>
          <dl className={css.gov}>
            <div><dt>{L("Drafts", "Draf")}</dt><dd>{L("The CEO, COO or super admin, with a reason", "CEO, COO atau super admin, dengan sebab")}</dd></div>
            <div><dt>{L("Approval", "Kelulusan")}</dt><dd>{L("The CEO (or super admin) only", "CEO (atau super admin) sahaja")}</dd></div>
            <div><dt>{L("Effective date", "Tarikh berkuat kuasa")}</dt><dd>{L("Today or later - never back-dated", "Hari ini atau kemudian - tidak sekali-kali ke belakang")}</dd></div>
            <div><dt>{L("History", "Sejarah")}</dt><dd>{L("Every version is kept; an entitlement keeps the version it was earned under", "Setiap versi disimpan; hak kekal dengan versi semasa diperoleh")}</dd></div>
            <div><dt>{L("CCO", "CCO")}</dt><dd>{L("Read-only monitoring", "Pemantauan baca sahaja")}</dd></div>
          </dl>
        </div>
      </TabZone>

      <TabZone label={L("Payroll link", "Pautan gaji")} hint={L("Until it is switched on, entitlements are recorded and shown, and payroll ignores them - so the figures can be checked first.", "Sehingga dihidupkan, hak direkod dan dipaparkan, dan gaji tidak mengambilnya - supaya angka boleh disemak dahulu.")}>
        <div className={card}>
          {!d ? <SkelRows rows={2} /> : (
            <div className={css.body}>
              <div className={css.head}><h3>{d.sync ? L("On - payroll takes eligible commission", "Hidup - gaji mengambil komisen layak") : L("Off - recorded only (shadow)", "Mati - direkod sahaja (bayang)")}</h3><span className={d.sync ? chipSuccess : chipWarn}>{d.sync ? L("On", "Hidup") : L("Off", "Mati")}</span></div>
              {d.can_switch && (
                <fieldset className={css.form}>
                  <label>{L("Reason", "Sebab")}<input aria-label={L("Switch reason", "Sebab suis")} className={inputClass} maxLength={500} value={switchReason} onChange={(e) => setSwitchReason(e.target.value)} placeholder={L("e.g. Checked the November entitlements", "cth. Telah menyemak hak November")} /></label>
                  <div className={css.formRow}><button type="button" className={d.sync ? btnSm : btnSmPrimary} disabled={switchReason.trim().length < 10 || (!d.sync && !p)} onClick={() => void flip(!d.sync)}><AppIcon name="lock" />{d.sync ? L("Switch payroll off", "Matikan gaji") : L("Switch payroll on", "Hidupkan gaji")}</button>
                    {!d.sync && !p && <span className={css.sub}>{L("Approve a policy first.", "Luluskan polisi dahulu.")}</span>}</div>
                </fieldset>
              )}
              {d.log.length > 0 && <ul className={css.list}>{d.log.map((x, i) => <li key={i}><span className={css.listMain}><strong>{x.value === "on" ? L("Switched on", "Dihidupkan") : L("Switched off", "Dimatikan")} · {x.changed_by_name ?? "—"}</strong><span>{dmyMYT(x.changed_at)} · {x.reason}</span></span></li>)}</ul>}
            </div>
          )}
        </div>
      </TabZone>

      <TabZone label={L("Versions", "Versi")} hint={L("Drafts, approvals and rejections, newest first. A preview applies a version to the last 60 days of confirmed invoices and writes nothing.", "Draf, kelulusan dan penolakan, terbaru dahulu. Pratonton menggunakan versi pada 60 hari invois disahkan dan tidak menulis apa-apa.")}>
        <div className={card}>
          {!d ? <SkelRows rows={3} /> : (
            <div className={css.body}>
              {d.can_draft && !form && <div className={css.formRow}><button type="button" className={btnSmPrimary} onClick={() => setForm({ name: p ? `${p.name}` : L("A2Z Sales Commission", "Komisen Jualan A2Z"), from: floor, kind: "percent", rate: p?.rate_bp ? String(p.rate_bp / 100) : "", fixed: "", basis: p?.basis ?? "net_of_tax_delivery", reason: "" })}><AppIcon name="add" />{L("Draft a new version", "Draf versi baharu")}</button></div>}
              {form && (
                <fieldset className={css.form} disabled={busy}>
                  <p className={css.groupLabel}>{L("New version (draft)", "Versi baharu (draf)")}</p>
                  <div className={css.row}>
                    <label>{L("Name", "Nama")}<input aria-label={L("Policy name", "Nama polisi")} className={inputClass} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                    <label>{L("Effective from (day the money lands)", "Berkuat kuasa mulai (hari wang diterima)")}<input type="date" aria-label={L("Effective from", "Berkuat kuasa mulai")} className={inputClass} min={floor} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
                  </div>
                  <div className={css.row}>
                    <label>{L("Kind", "Jenis")}<select aria-label={L("Rate kind", "Jenis kadar")} className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "fixed" })}><option value="percent">{L("Percentage of the basis", "Peratusan asas")}</option><option value="fixed">{L("Fixed amount per invoice", "Jumlah tetap setiap invois")}</option></select></label>
                    {form.kind === "percent"
                      ? <label>{L("Rate (%)", "Kadar (%)")}<input type="number" aria-label={L("Rate percent", "Kadar peratus")} min="0.01" max="50" step="0.01" className={inputClass} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
                      : <label>{L("Amount (RM)", "Jumlah (RM)")}<input type="number" aria-label={L("Fixed amount", "Jumlah tetap")} min="0.01" step="0.01" className={inputClass} value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} /></label>}
                  </div>
                  <label>{L("Calculation basis", "Asas pengiraan")}<select aria-label={L("Calculation basis", "Asas pengiraan")} className={inputClass} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as "net_of_tax_delivery" | "invoice_total" })}>
                    <option value="net_of_tax_delivery">{basisText("net_of_tax_delivery")}</option><option value="invoice_total">{basisText("invoice_total")}</option></select></label>
                  <label>{L("Reason for this version", "Sebab versi ini")}<textarea aria-label={L("Policy reason", "Sebab polisi")} className={inputClass} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                  <p className={css.sub}>{L("Eligibility (paid in full and confirmed), every paid renewal, refunds to review and the payroll cutoff are the approved rules of 29-10-2026; changing them needs the owner's approval first.", "Kelayakan (dibayar penuh dan disahkan), setiap pembaharuan dibayar, bayaran balik untuk semakan dan potongan gaji ialah peraturan diluluskan 29-10-2026.")}</p>
                  <div className={css.formRow}>
                    <button type="button" className={btnClass} disabled={form.name.trim().length < 3 || form.reason.trim().length < 10 || (form.kind === "percent" ? !(Number(form.rate) > 0) : !(Number(form.fixed) > 0))} onClick={() => void saveDraft()}><AppIcon name="save" />{L("Save draft", "Simpan draf")}</button>
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
                        <span>{L("Drafted by", "Draf oleh")} {v.created_by_name ?? "—"} · {dmyMYT(v.created_at)} · {v.reason}</span>
                        {v.status === "active" && <span>{L("Approved by", "Diluluskan oleh")} {v.approved_by_name ?? "—"} · {v.approved_at ? dmyMYT(v.approved_at) : ""}</span>}
                        {v.status === "rejected" && <span>{L("Rejected by", "Ditolak oleh")} {v.rejected_by_name ?? "—"} · {v.reject_reason}</span>}
                      </span>
                      <span className={css.formRow}>
                        <span className={v.status === "active" ? chipSuccess : v.status === "draft" ? chipWarn : chipNeutral}>{v.status === "active" ? L("Active", "Aktif") : v.status === "draft" ? L("Proposed - not approved", "Dicadang - belum diluluskan") : L("Rejected", "Ditolak")}</span>
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
export function CommissionPanel({ user }: { user: { id: number; role: string } }) {
  const all = VIEW_ALL.includes(user.role);
  const [view, setView] = useState<View>("entries");
  const [seen, setSeen] = useState<Record<View, boolean>>({ entries: true, flow: false, policy: false });
  const [scope, setScope] = useState<WsScope>(all ? "all" : "mine");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const open = (v: View) => { setView(v); setSeen((s) => ({ ...s, [v]: true })); };
  const sKey = `${scope}|${revision}`;
  const [sum, setSum] = useState<{ k: string; d: Summary | null; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<Summary>(`/summary?scope=${sKey.split("|")[0]}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setSum({ k: sKey, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [sKey]);
  const s = sum?.k === sKey ? sum.d : null;
  const tabs = all
    ? ([["entries", L("Entries", "Entri")], ["flow", L("Flow", "Aliran")], ["policy", L("Policy", "Polisi")]] as const)
    : ([["entries", L("My commission", "Komisen saya")]] as const);
  return (
    <TabPage>
      <LineTabs value={view} onChange={open} tabs={tabs} label={L("Commission", "Komisen")}
        aside={<TabAside>{all && view === "entries" && <ScopeSwitch scope={scope} onChange={setScope} />}<button type="button" className={btnSm} title={L("Refresh", "Muat semula")} aria-label={L("Refresh commission", "Muat semula komisen")} onClick={reload}><AppIcon name="refresh" /></button></TabAside>} />
      {sum?.e && <p role="alert" className={css.error}>{sum.e}</p>}
      <TabZone label={all && scope === "all" ? L("The team at a glance", "Pasukan sepintas lalu") : L("Mine at a glance", "Milik saya sepintas lalu")}>
      {!s && !sum?.e ? <KpiRow label={L("Commission at a glance", "Ringkasan komisen")}><SkelStat /><SkelStat /><SkelStat /><SkelStat /></KpiRow> : <KpiRow label={L("Commission at a glance", "Ringkasan komisen")}>
        <KpiTile icon="pending" tone="navy" busy={!s} label={L("Estimated", "Anggaran")} value={fmtRM(s?.estimated.cents ?? 0)} sub={s ? L(`${s.estimated.n} open invoice(s) - not earned yet`, `${s.estimated.n} invois terbuka - belum diperoleh`) : undefined} />
        <KpiTile icon="verify" tone="gold" busy={!s} label={L("Eligible", "Layak")} value={fmtRM(s?.eligible.cents ?? 0)} sub={s ? (s.review.n ? L(`${s.eligible.n} entr(ies) · ${s.review.n} under review`, `${s.eligible.n} entri · ${s.review.n} dalam semakan`) : L(`${s.eligible.n} entr(ies) waiting for payroll`, `${s.eligible.n} entri menunggu gaji`)) : undefined} />
        <KpiTile icon="money" tone="blue" busy={!s} label={L("Included in payroll", "Dalam gaji")} value={fmtRM(s?.included.cents ?? 0)} sub={s ? (s.sync ? L(`${s.included.n} entr(ies), bank run not yet done`, `${s.included.n} entri, pembayaran bank belum selesai`) : L("Payroll link not switched on yet", "Pautan gaji belum dihidupkan")) : undefined} />
        <KpiTile icon="paid" tone="green" busy={!s} label={L("Commission paid", "Komisen dibayar")} value={fmtRM(s?.paid.cents ?? 0)} sub={s ? L(`${ym(s.month)} payroll · ${s.paid.n} entr(ies)`, `Gaji ${ym(s.month)} · ${s.paid.n} entri`) : undefined} />
      </KpiRow>}
      </TabZone>
      {s && !s.policy && <p className={`${css.note} ${css.warnNote}`}>{L("No commission policy is approved yet - nothing is estimated or earned until the CEO approves one (Policy).", "Tiada polisi komisen diluluskan lagi - tiada apa dianggar atau diperoleh sehingga CEO meluluskannya (Polisi).")}</p>}
      <div className={css.body} hidden={view !== "entries"}>{seen.entries && <Entries scope={all ? scope : "mine"} revision={revision} onChanged={reload} />}</div>
      {all && <div className={css.body} hidden={view !== "flow"}>{seen.flow && <Flow revision={revision} />}</div>}
      {all && <div className={css.body} hidden={view !== "policy"}>{seen.policy && <PolicyView revision={revision} onChanged={reload} />}</div>}
    </TabPage>
  );
}
