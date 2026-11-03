"use client";

/* v1.255.0 - COMMISSION > AGENT DEALS (the owner's "Final CEO Commission
   Policy Clarification", claude/AGENT-COMMISSION-AUDIT.md revision 3, his
   "approved", 03-11-2026). Part of the Commission tab - not a module of its
   own. Management reads it (the CCO included, read only); the CEO or super
   admin decides.

   - Held for review: every paid agent-linked sale whose attribution is not
     certain. Nothing is payable until a decision: an agent partnership
     (agent + closer rates of a chosen version), a direct sale, or no
     commission - always with the reason, the evidence kept as it was.
   - Agent payouts: authorise (no money moves), then a DIFFERENT approver
     confirms the bank settlement with its reference and date - one
     cash-book row, then.
   - Disputes and the agent switch.
   Every figure and rule is the worker's (worker/src/commission.ts). */

import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows, SkelStat } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { TabZone } from "@/components/portal/tab-concept";
import { makeApi, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import css from "./commission.module.css";

const api = makeApi("/staff/commission");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
const pctOf = (bp: number | null | undefined) => `${((bp ?? 0) / 100).toFixed((bp ?? 0) % 100 ? 2 : 0)}%`;

/* the hold reasons, as the worker names them */
const REASON: Record<string, [string, string]> = {
  disputed: ["Attribution disputed (flagged by management)", "Atribusi dipertikai (ditanda pengurusan)"],
  agent_partnership_off: ["Agent deals were switched off", "Urusan ejen dimatikan"],
  multiple_requests: ["More than one agent request on this quotation", "Lebih daripada satu permintaan ejen pada sebut harga ini"],
  agent_customer_repeat: ["A renewal or repeat order of an agent's customer (R3)", "Pembaharuan atau pesanan ulangan pelanggan ejen (R3)"],
  not_won: ["The agent request is not Won", "Permintaan ejen belum Berjaya"],
  not_published: ["The invoiced quotation is not the one published to the agent", "Sebut harga diinvois bukan yang diterbitkan kepada ejen"],
  no_acceptance: ["No client acceptance on the published revision", "Tiada penerimaan pelanggan pada semakan yang diterbitkan"],
  revision_mismatch: ["The invoiced revision is not the accepted one", "Semakan diinvois bukan yang diterima"],
  agent_inactive: ["The agent account is not active", "Akaun ejen tidak aktif"],
  agent_policy_missing: ["No approved version with agent rates on the paid day", "Tiada versi diluluskan dengan kadar ejen pada hari dibayar"],
  policy_conflict: ["A line follows a package rule of its own", "Satu baris mengikut peraturan pakejnya sendiri"],
};
const reasonText = (k: string) => (REASON[k] ? L(REASON[k][0], REASON[k][1]) : k);

interface Attr {
  id: number; invoice_id: number; doc_number: string; invoice_total: number; company: string | null; classification: "direct" | "partnership" | "review"; reasons: string[];
  agent_id: number | null; agent_name: string | null; agent_request_id: number | null; quotation_number: string | null; published_revision: number | null; invoiced_revision: number | null;
  accepted_name: string | null; accepted_at: string | null; assigned_name: string | null; closer_name: string | null; paid_day: string; policy_version: number | null;
  eligible_cents: number | null; agent_cents: number | null; closer_cents: number | null; created_at: string; revoked_at: string | null;
  decision: "partnership" | "direct" | "none" | null; decided_at: string | null; decided_by_name: string | null; decision_note: string | null; closed_at: string | null; closed_reason: string | null;
}
interface Version { id: number; version: number; name: string; effective_from: string; rate_bp: number | null; agent_rate_bp: number | null; agent_closer_rate_bp: number | null }
interface Dispute { id: number; scope: "invoice" | "customer"; ref_label: string | null; reason: string; created_at: string; created_by_name: string | null; cleared_at: string | null; cleared_by_name: string | null; clear_reason: string | null }
interface AttrResp { attributions: Attr[]; versions: Version[]; disputes: Dispute[]; agents: { id: number; name: string; is_active: number }[]; can_decide: boolean; can_flag: boolean; today: string; pending_migration?: boolean }
interface Payout {
  id: number; agent_id: number; agent_name: string | null; status: "authorized" | "settled" | "cancelled"; amount_cents: number; row_count: number; note: string | null;
  authorized_by: number; authorized_by_name: string | null; authorized_at: string; settled_by_name: string | null; settled_on: string | null; bank_ref: string | null; proof_note: string | null;
  cancelled_by_name: string | null; cancel_reason: string | null;
}
interface PayResp { due: { agent_id: number; agent_name: string; is_active: number; n: number; cents: number }[]; payouts: Payout[]; can_authorise: boolean; can_settle: boolean; me: number; today: string; pending_migration?: boolean }
const AGR = (id: number | null) => (id ? `AGR-${String(id).padStart(4, "0")}` : "—");
const dealText = (a: Attr) => a.decision === "partnership" ? L("Agent partnership (decided)", "Perkongsian ejen (diputuskan)") : a.decision === "direct" ? L("Direct sale (decided)", "Jualan langsung (diputuskan)")
  : a.decision === "none" ? L("No commission (decided)", "Tiada komisen (diputuskan)") : a.closed_at ? L("Closed - confirmation taken back", "Ditutup - pengesahan ditarik balik")
  : a.classification === "partnership" ? L("Agent partnership", "Perkongsian ejen") : a.classification === "review" ? L("Held for review", "Ditahan untuk semakan") : L("Direct sale", "Jualan langsung");

export function AgentDeals({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const key = `${revision}|${tick}`;
  const [got, setGot] = useState<{ k: string; a: AttrResp | null; p: PayResp | null; sw: string | null; canSw: boolean; e: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      api<AttrResp>(`/attributions?status=agent`, { signal: c.signal }),
      api<PayResp>(`/payouts`, { signal: c.signal }),
      api<{ agent_partnership?: string; can_switch?: boolean }>(`/policy`, { signal: c.signal }),
    ]).then(([a, p, s]) => {
      if (c.signal.aborted) return;
      setGot({ k: key, a: a.ok && a.data ? a.data : null, p: p.ok && p.data ? p.data : null, sw: s.ok && s.data ? s.data.agent_partnership ?? "on" : null, canSw: !!(s.ok && s.data?.can_switch), e: !a.ok ? message(a) : !p.ok ? message(p) : "" });
    });
    return () => c.abort();
  }, [key]);
  const reload = useCallback(() => { setTick((t) => t + 1); onChanged(); }, [onChanged]);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt: ask, node: askNode } = usePrompt();
  const [error, setError] = useState("");
  const cur = got?.k === key ? got : null;
  const a = cur?.a, p = cur?.p;
  const queue = (a?.attributions ?? []).filter((x) => x.classification === "review" && !x.decision && !x.closed_at);
  const recent = (a?.attributions ?? []).filter((x) => !(x.classification === "review" && !x.decision && !x.closed_at)).slice(0, 30);
  const toSettle = (p?.payouts ?? []).filter((x) => x.status === "authorized");
  const settled = (p?.payouts ?? []).filter((x) => x.status !== "authorized");

  const authorise = async (d: PayResp["due"][number]) => {
    if (!(await confirm({ title: L(`Authorise ${fmtRM(d.cents)} for ${d.agent_name}?`, `Benarkan ${fmtRM(d.cents)} untuk ${d.agent_name}?`), message: L(`${d.n} eligible sale(s). No money is booked now: a different approver confirms the bank settlement with its reference.`, `${d.n} jualan layak. Tiada wang dibukukan sekarang: pelulus lain mengesahkan penyelesaian bank dengan rujukannya.`), confirmLabel: L("Authorise payout", "Benarkan bayaran") }))) return;
    setError("");
    const r = await api<{ ref: string; amount_cents: number }>(`/payouts`, { method: "POST", body: JSON.stringify({ agent_id: d.agent_id }) });
    if (r.ok) { toast(L("Payout authorised", "Bayaran dibenarkan"), L(`${r.data?.ref} · ${fmtRM(r.data?.amount_cents ?? 0)} - waiting for the settlement`, `${r.data?.ref} · ${fmtRM(r.data?.amount_cents ?? 0)} - menunggu penyelesaian`)); reload(); } else setError(message(r));
  };
  const cancel = async (o: Payout) => {
    const v = await ask({ title: L(`Cancel AGT-${o.id}?`, `Batal AGT-${o.id}?`), label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Cancel payout", "Batal bayaran") });
    const reason = v?.value?.trim() ?? "";
    if (!reason) return;
    const r = await api(`/payouts/${o.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    if (r.ok) { toast(L("Payout cancelled", "Bayaran dibatalkan"), L("Its sales are eligible again", "Jualannya layak semula")); reload(); } else setError(message(r));
  };
  const flipSwitch = async () => {
    const to = cur?.sw === "off" ? "on" : "off";
    const v = await ask({ title: to === "off" ? L("Switch agent deals off?", "Matikan urusan ejen?") : L("Switch agent deals back on?", "Hidupkan semula urusan ejen?"),
      message: to === "off" ? L("Every new agent-linked sale is then HELD for review - never paid as a direct sale. Nothing already written changes.", "Setiap jualan berkaitan ejen baharu akan DITAHAN untuk semakan - tidak dibayar sebagai jualan langsung. Tiada apa yang sudah ditulis berubah.") : undefined,
      label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: to === "off" ? L("Switch off", "Matikan") : L("Switch on", "Hidupkan") });
    const reason = v?.value?.trim() ?? "";
    if (!reason) return;
    const r = await api(`/settings`, { method: "POST", body: JSON.stringify({ agent_partnership: to, reason }) });
    if (r.ok) { toast(to === "off" ? L("Agent deals switched off", "Urusan ejen dimatikan") : L("Agent deals on", "Urusan ejen dihidupkan"), L("Recorded with your reason", "Direkod dengan sebab anda")); reload(); } else setError(message(r));
  };

  return (
    <>
      {toastNode}{confirmNode}{askNode}
      {cur?.e && <p role="alert" className={css.error}>{cur.e}</p>}
      {error && <p role="alert" className={css.error}>{error}</p>}
      {(a?.pending_migration || p?.pending_migration) && <p className={`${css.note} ${css.warnNote}`}>{L("Run migration 0168 (PUSH.bat) to use agent deals.", "Jalankan migrasi 0168 (PUSH.bat) untuk urusan ejen.")}</p>}
      <TabZone label={L("Agent deals at a glance", "Urusan ejen sepintas lalu")}>
        {!cur ? <KpiRow label={L("Agent deals at a glance", "Urusan ejen sepintas lalu")}><SkelStat /><SkelStat /><SkelStat /><SkelStat /></KpiRow> : (
          <KpiRow label={L("Agent deals at a glance", "Urusan ejen sepintas lalu")}>
            <KpiTile icon="pending" tone="gold" label={L("Held for review", "Ditahan untuk semakan")} value={String(queue.length)} sub={L("Nothing payable until decided", "Tiada boleh dibayar sehingga diputuskan")} />
            <KpiTile icon="verify" tone="navy" label={L("Eligible for agents", "Layak untuk ejen")} value={fmtRM((p?.due ?? []).reduce((s, d) => s + Number(d.cents), 0))} sub={L(`${p?.due.length ?? 0} agent(s) to authorise`, `${p?.due.length ?? 0} ejen untuk dibenarkan`)} />
            <KpiTile icon="money" tone="blue" label={L("Authorised, not settled", "Dibenarkan, belum selesai")} value={fmtRM(toSettle.reduce((s, o) => s + Number(o.amount_cents ?? 0), 0))} sub={L(`${toSettle.length} payout(s) waiting for the bank`, `${toSettle.length} bayaran menunggu bank`)} />
            <KpiTile icon="balance" tone={cur.sw === "off" ? "gold" : "green"} label={L("Agent deals", "Urusan ejen")} value={cur.sw === "off" ? L("Switched off", "Dimatikan") : L("On", "Hidup")} sub={cur.sw === "off" ? L("New agent sales are held", "Jualan ejen baharu ditahan") : L("Paid by the approved version's rates", "Dibayar mengikut kadar versi diluluskan")} />
          </KpiRow>
        )}
      </TabZone>

      <TabZone label={L("Held for review", "Ditahan untuk semakan")} hint={L("A paid sale linked to an agent whose attribution is not certain. It is never paid as a direct sale by itself. Decide each with the evidence below and your reason.", "Jualan dibayar yang berkaitan ejen yang atribusinya tidak pasti. Ia tidak sekali-kali dibayar sebagai jualan langsung dengan sendirinya. Putuskan setiap satu dengan bukti di bawah dan sebab anda.")}>
        <div className={card}>
          {!a ? <SkelRows rows={4} /> : queue.length === 0 ? <p className={css.empty}>{L("Nothing is held. Every paid sale so far is a direct sale or a verified agent deal.", "Tiada yang ditahan. Setiap jualan dibayar setakat ini ialah jualan langsung atau urusan ejen yang disahkan.")}</p> : (
            <ul className={css.list} data-testid="attribution-queue">{queue.map((x) => <ReviewItem key={x.id} x={x} d={a} onDone={(t) => { toast(L("Decision recorded", "Keputusan direkod"), t); reload(); }} />)}</ul>
          )}
        </div>
      </TabZone>

      <TabZone label={L("Agent payouts", "Bayaran ejen")} hint={L("Authorise what an agent has earned (nothing is booked), then a different approver confirms the transfer with the bank reference and date. The cash book gets one row, at settlement. Agents are never paid through payroll.", "Benarkan apa yang diperoleh ejen (tiada dibukukan), kemudian pelulus lain mengesahkan pindahan dengan rujukan dan tarikh bank. Buku tunai mendapat satu baris, semasa penyelesaian. Ejen tidak dibayar melalui gaji.")} cols={2}>
        <div className={card}>
          <div className={css.head}><h3>{L("Eligible to authorise", "Layak untuk dibenarkan")}</h3></div>
          {!p ? <SkelRows rows={3} /> : p.due.length === 0 ? <p className={css.empty}>{L("No agent commission is eligible yet.", "Belum ada komisen ejen yang layak.")}</p> : (
            <ul className={css.list}>{p.due.map((d) => (
              <li key={d.agent_id}><span className={css.listMain}><strong>{d.agent_name} · {fmtRM(d.cents)}</strong><span>{L(`${d.n} sale(s)`, `${d.n} jualan`)}{d.is_active ? "" : ` · ${L("account suspended", "akaun digantung")}`}</span></span>
                {p.can_authorise && <button type="button" className={btnSmPrimary} onClick={() => void authorise(d)}><AppIcon name="success" />{L("Authorise payout", "Benarkan bayaran")}</button>}</li>
            ))}</ul>
          )}
        </div>
        <div className={card}>
          <div className={css.head}><h3>{L("Waiting for the bank settlement", "Menunggu penyelesaian bank")}</h3></div>
          {!p ? <SkelRows rows={3} /> : toSettle.length === 0 ? <p className={css.empty}>{L("Nothing waiting.", "Tiada yang menunggu.")}</p> : (
            <ul className={css.list}>{toSettle.map((o) => <SettleItem key={o.id} o={o} me={p.me} can={p.can_settle} today={p.today} onCancel={() => void cancel(o)} onDone={(t) => { toast(L("Settlement confirmed", "Penyelesaian disahkan"), t); reload(); }} />)}</ul>
          )}
        </div>
      </TabZone>
      {p && settled.length > 0 && (
        <TabZone label={L("Payout history", "Sejarah bayaran")}>
          <div className={card}>
            <ul className={css.list}>{settled.map((o) => (
              <li key={o.id}><span className={css.listMain}><strong>AGT-{o.id} · {o.agent_name ?? "—"} · {fmtRM(o.amount_cents ?? 0)}</strong>
                <span>{o.status === "settled" ? L(`Settled ${dmy(o.settled_on ?? "")} · ref ${o.bank_ref} · confirmed by ${o.settled_by_name ?? "—"} · authorised by ${o.authorized_by_name ?? "—"}`, `Selesai ${dmy(o.settled_on ?? "")} · rujukan ${o.bank_ref} · disahkan oleh ${o.settled_by_name ?? "—"} · dibenarkan oleh ${o.authorized_by_name ?? "—"}`)
                  : L(`Cancelled by ${o.cancelled_by_name ?? "—"} · ${o.cancel_reason ?? ""}`, `Dibatalkan oleh ${o.cancelled_by_name ?? "—"} · ${o.cancel_reason ?? ""}`)}</span></span>
                <span className={css.top}><span className={o.status === "settled" ? chipSuccess : chipNeutral}>{o.status === "settled" ? L("Paid", "Dibayar") : L("Cancelled", "Dibatalkan")}</span></span></li>
            ))}</ul>
          </div>
        </TabZone>
      )}

      <TabZone label={L("Disputes and the agent switch", "Pertikaian dan suis ejen")} cols={2}>
        <Disputes d={a ?? null} onDone={(t) => { toast(t, ""); reload(); }} onError={setError} />
        <div className={card}>
          <div className={css.head}><h3>{L("Agent deals switch", "Suis urusan ejen")}</h3><span className={cur?.sw === "off" ? chipWarn : chipSuccess}>{cur?.sw === "off" ? L("Off", "Mati") : L("On", "Hidup")}</span></div>
          <p className={css.sub}>{L("Off holds every new agent-linked sale for your review. It never turns an agent sale into a direct sale, and nothing already recorded changes.", "Mati menahan setiap jualan berkaitan ejen baharu untuk semakan anda. Ia tidak menukar jualan ejen kepada jualan langsung, dan tiada apa yang sudah direkod berubah.")}</p>
          {cur?.canSw && <div className={css.formRow}><button type="button" className={btnSm} onClick={() => void flipSwitch()}>{cur.sw === "off" ? L("Switch on", "Hidupkan") : L("Switch off", "Matikan")}</button></div>}
        </div>
      </TabZone>

      {recent.length > 0 && (
        <TabZone label={L("Recent agent deals", "Urusan ejen terkini")}>
          <div className={card}>
            <ul className={css.list}>{recent.map((x) => (
              <li key={x.id}><span className={css.listMain}><strong>{x.doc_number} · {x.company ?? "—"} · {dealText(x)}</strong>
                <span>{[x.agent_name ? `${L("Agent", "Ejen")} ${x.agent_name}` : null, x.closer_name ? `${L("closer", "penutup")} ${x.closer_name}` : null, x.agent_cents !== null ? `${L("agent", "ejen")} ${fmtRM(x.agent_cents)}` : null, x.closer_cents !== null ? `${L("closer", "penutup")} ${fmtRM(x.closer_cents)}` : null, dmy(x.paid_day)].filter(Boolean).join(" · ")}</span>
                {x.decision_note && <span>{L("Decision", "Keputusan")}: {x.decision_note} · {x.decided_by_name ?? "—"} · {x.decided_at ? dmyMYT(x.decided_at) : ""}</span>}</span>
                <span className={css.top}><span className={x.classification === "partnership" || x.decision === "partnership" ? chipInfo : chipNeutral}>{dealText(x)}</span></span></li>
            ))}</ul>
          </div>
        </TabZone>
      )}
    </>
  );
}

function ReviewItem({ x, d, onDone }: { x: Attr; d: AttrResp; onDone: (t: string) => void }) {
  const withRates = d.versions.filter((v) => v.agent_rate_bp != null && v.agent_closer_rate_bp != null);
  const [decision, setDecision] = useState<"" | "partnership" | "direct" | "none">("");
  const [ver, setVer] = useState<number>(withRates[0]?.id ?? 0);
  const [agent, setAgent] = useState<number>(x.agent_id ?? 0);
  const [note, setNote] = useState("");
  const [retro, setRetro] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const v = withRates.find((y) => y.id === ver) ?? null;
  const needsRetro = decision === "partnership" && !!v && v.effective_from > x.paid_day;
  const submit = async () => {
    setBusy(true); setErr("");
    const r = await api<{ closer_cents?: number; agent_cents?: number }>(`/attributions/${x.id}/decide`, { method: "POST", body: JSON.stringify({ decision, note, ...(decision === "partnership" ? { policy_id: ver, agent_id: agent || undefined, confirm_retro: retro } : {}) }) });
    setBusy(false);
    if (r.ok) onDone(decision === "partnership" ? L(`Agent ${fmtRM(r.data?.agent_cents ?? 0)} + closer ${fmtRM(r.data?.closer_cents ?? 0)}`, `Ejen ${fmtRM(r.data?.agent_cents ?? 0)} + penutup ${fmtRM(r.data?.closer_cents ?? 0)}`) : decision === "direct" ? L(`Direct sale: closer ${fmtRM(r.data?.closer_cents ?? 0)}`, `Jualan langsung: penutup ${fmtRM(r.data?.closer_cents ?? 0)}`) : L("No commission", "Tiada komisen"));
    else setErr(message(r));
  };
  return (
    <li data-testid={`attr-${x.id}`}>
      <span className={css.listMain}>
        <strong>{x.doc_number} · {x.company ?? "—"} · {fmtRM(x.invoice_total)} · {L("paid", "dibayar")} {dmy(x.paid_day)}</strong>
        <span>{x.reasons.map(reasonText).join(" · ")}</span>
        <span>{L("Agent", "Ejen")}: {x.agent_name ?? L("none named", "tiada dinamakan")} · {L("request", "permintaan")} {AGR(x.agent_request_id)} · {L("quotation", "sebut harga")} {x.quotation_number ?? "—"}
          {x.published_revision !== null ? ` · ${L("published rev", "semakan diterbitkan")} ${x.published_revision}` : ""}{x.invoiced_revision !== null ? ` · ${L("invoiced rev", "semakan diinvois")} ${x.invoiced_revision}` : ""}</span>
        <span>{L("Acceptance", "Penerimaan")}: {x.accepted_name ? `${x.accepted_name} · ${dmyMYT(x.accepted_at ?? "")}` : L("none on the published revision", "tiada pada semakan diterbitkan")} · {L("assigned", "ditugaskan")} {x.assigned_name ?? "—"} · {L("closer", "penutup")} {x.closer_name ?? "—"}</span>
        {d.can_decide && (
          <fieldset className={css.form} disabled={busy}>
            <div className={css.row}>
              <label><span className={fieldLabel}>{L("Decision", "Keputusan")}</span>
                <select aria-label={L(`Decision for ${x.doc_number}`, `Keputusan untuk ${x.doc_number}`)} className={inputClass} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="">{L("Choose…", "Pilih…")}</option>
                  <option value="partnership" disabled={!withRates.length}>{L("Agent partnership (agent + closer rates)", "Perkongsian ejen (kadar ejen + penutup)")}</option>
                  <option value="direct">{L("Reject the referral - direct sale", "Tolak rujukan - jualan langsung")}</option>
                  <option value="none">{L("No commission", "Tiada komisen")}</option>
                </select></label>
              {decision === "partnership" && <label><span className={fieldLabel}>{L("Version", "Versi")}</span>
                <select aria-label={L("Policy version", "Versi polisi")} className={inputClass} value={ver} onChange={(e) => setVer(Number(e.target.value))}>
                  {withRates.map((y) => <option key={y.id} value={y.id}>{`v${y.version} · ${L("agent", "ejen")} ${pctOf(y.agent_rate_bp)} + ${L("closer", "penutup")} ${pctOf(y.agent_closer_rate_bp)} · ${L("from", "mulai")} ${dmy(y.effective_from)}`}</option>)}
                </select></label>}
              {decision === "partnership" && !x.agent_id && <label><span className={fieldLabel}>{L("Agent", "Ejen")}</span>
                <select aria-label={L("Agent", "Ejen")} className={inputClass} value={agent} onChange={(e) => setAgent(Number(e.target.value))}>
                  <option value={0}>{L("Choose…", "Pilih…")}</option>{d.agents.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select></label>}
            </div>
            {needsRetro && <label className={css.check}><input type="checkbox" checked={retro} onChange={(e) => setRetro(e.target.checked)} />{L(`The money landed on ${dmy(x.paid_day)}, before v${v!.version} started (${dmy(v!.effective_from)}). I confirm this retrospective allocation.`, `Wang diterima pada ${dmy(x.paid_day)}, sebelum v${v!.version} bermula (${dmy(v!.effective_from)}). Saya mengesahkan peruntukan retrospektif ini.`)}</label>}
            <label>{L("Reason", "Sebab")}<textarea aria-label={L("Decision reason", "Sebab keputusan")} className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className={css.formRow}>
              <button type="button" className={btnClass} disabled={!decision || note.trim().length < 10 || (needsRetro && !retro) || (decision === "partnership" && (!ver || (!x.agent_id && !agent)))} onClick={() => void submit()}><AppIcon name="success" />{L("Record decision", "Rekod keputusan")}</button>
            </div>
            {err && <p role="alert" className={css.error}>{err}</p>}
          </fieldset>
        )}
      </span>
      <span className={css.top}><span className={chipWarn}>{L("Held", "Ditahan")}</span></span>
    </li>
  );
}

function SettleItem({ o, me, can, today, onCancel, onDone }: { o: Payout; me: number; can: boolean; today: string; onCancel: () => void; onDone: (t: string) => void }) {
  const [bank, setBank] = useState("");
  const [on, setOn] = useState(today || mytToday());
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mine = o.authorized_by === me;
  const settle = async () => {
    setBusy(true); setErr("");
    const r = await api(`/payouts/${o.id}/settle`, { method: "POST", body: JSON.stringify({ bank_ref: bank, settled_on: on, proof_note: proof || undefined }) });
    setBusy(false);
    if (r.ok) onDone(L(`AGT-${o.id} · ${fmtRM(o.amount_cents)} · ref ${bank}`, `AGT-${o.id} · ${fmtRM(o.amount_cents)} · rujukan ${bank}`)); else setErr(message(r));
  };
  return (
    <li data-testid={`payout-${o.id}`}>
      <span className={css.listMain}>
        <strong>AGT-{o.id} · {o.agent_name ?? "—"} · {fmtRM(o.amount_cents)}</strong>
        <span>{L(`${o.row_count} sale(s) · authorised by ${o.authorized_by_name ?? "—"} · ${dmyMYT(o.authorized_at)}`, `${o.row_count} jualan · dibenarkan oleh ${o.authorized_by_name ?? "—"} · ${dmyMYT(o.authorized_at)}`)}</span>
        {can && (mine ? <span className={css.sub}>{L("Dual control: another CEO or super admin confirms the settlement of a payout you authorised.", "Kawalan dua: CEO atau super admin lain mengesahkan penyelesaian bayaran yang anda benarkan.")}</span> : (
          <fieldset className={css.form} disabled={busy}>
            <div className={css.row}>
              <label>{L("Bank reference", "Rujukan bank")}<input aria-label={L("Bank reference", "Rujukan bank")} className={inputClass} maxLength={80} value={bank} onChange={(e) => setBank(e.target.value)} /></label>
              <label>{L("Paid by the bank on", "Dibayar bank pada")}<input type="date" aria-label={L("Settlement date", "Tarikh penyelesaian")} className={inputClass} max={today} value={on} onChange={(e) => setOn(e.target.value)} /></label>
            </div>
            <label>{L("Proof note (optional)", "Nota bukti (pilihan)")}<input aria-label={L("Proof note", "Nota bukti")} className={inputClass} maxLength={300} value={proof} onChange={(e) => setProof(e.target.value)} /></label>
            <div className={css.formRow}><button type="button" className={btnClass} disabled={bank.trim().length < 3 || !on} onClick={() => void settle()}><AppIcon name="paid" />{L("Confirm settlement", "Sahkan penyelesaian")}</button></div>
            {err && <p role="alert" className={css.error}>{err}</p>}
          </fieldset>
        ))}
      </span>
      {can && <button type="button" className={btnSm} onClick={onCancel}>{L("Cancel", "Batal")}</button>}
    </li>
  );
}

function Disputes({ d, onDone, onError }: { d: AttrResp | null; onDone: (t: string) => void; onError: (e: string) => void }) {
  const [doc, setDoc] = useState("");
  const [scope, setScope] = useState<"invoice" | "customer">("invoice");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { prompt: ask, node } = usePrompt();
  const open = (d?.disputes ?? []).filter((x) => !x.cleared_at);
  const flag = async () => {
    setBusy(true); onError("");
    const r = await api(`/disputes`, { method: "POST", body: JSON.stringify({ scope, doc_number: doc.trim(), reason }) });
    setBusy(false);
    if (r.ok) { setDoc(""); setReason(""); onDone(L("Flagged as disputed - its sales are held for review", "Ditanda dipertikai - jualannya ditahan untuk semakan")); } else onError(message(r));
  };
  const clear = async (x: Dispute) => {
    const v = await ask({ title: L("Clear this dispute?", "Kosongkan pertikaian ini?"), label: L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)"), required: true, confirmLabel: L("Clear dispute", "Kosongkan") });
    const why = v?.value?.trim() ?? "";
    if (!why) return;
    const r = await api(`/disputes/${x.id}/clear`, { method: "POST", body: JSON.stringify({ reason: why }) });
    if (r.ok) onDone(L("Dispute cleared - later sales classify normally", "Pertikaian dikosongkan")); else onError(message(r));
  };
  return (
    <div className={card}>
      {node}
      <div className={css.head}><h3>{L("Disputed attributions", "Atribusi dipertikai")}</h3></div>
      {!d ? <SkelRows rows={2} /> : (<>
        {open.length === 0 ? <p className={css.empty}>{L("No open dispute.", "Tiada pertikaian terbuka.")}</p> : (
          <ul className={css.list}>{open.map((x) => (
            <li key={x.id}><span className={css.listMain}><strong>{x.scope === "invoice" ? L("Invoice", "Invois") : L("Customer", "Pelanggan")} {x.ref_label ?? "—"}</strong><span className={css.preLine}>{x.reason}</span><span>{x.created_by_name ?? "—"} · {dmyMYT(x.created_at)}</span></span>
              {d.can_decide && <button type="button" className={btnSm} onClick={() => void clear(x)}>{L("Clear", "Kosongkan")}</button>}</li>
          ))}</ul>
        )}
        {d.can_flag && (
          <fieldset className={css.form} disabled={busy}>
            <p className={css.groupLabel}>{L("Flag a dispute", "Tanda pertikaian")}</p>
            <div className={css.row}>
              <label>{L("Invoice number", "Nombor invois")}<input aria-label={L("Invoice number", "Nombor invois")} className={inputClass} maxLength={60} value={doc} onChange={(e) => setDoc(e.target.value)} /></label>
              <label>{L("Applies to", "Terpakai pada")}<select aria-label={L("Dispute scope", "Skop pertikaian")} className={inputClass} value={scope} onChange={(e) => setScope(e.target.value as "invoice" | "customer")}>
                <option value="invoice">{L("This invoice", "Invois ini")}</option><option value="customer">{L("Its customer (later invoices too)", "Pelanggannya (invois kemudian juga)")}</option></select></label>
            </div>
            <label>{L("Reason", "Sebab")}<textarea aria-label={L("Dispute reason", "Sebab pertikaian")} className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <p className={css.sub}>{L("A sale confirmed after this is held for the CEO's review. Sales already decided are not changed.", "Jualan yang disahkan selepas ini ditahan untuk semakan CEO. Jualan yang telah diputuskan tidak diubah.")}</p>
            <div className={css.formRow}><button type="button" className={btnSm} disabled={doc.trim().length < 3 || reason.trim().length < 10} onClick={() => void flag()}>{L("Flag as disputed", "Tanda dipertikai")}</button></div>
          </fieldset>
        )}
      </>)}
    </div>
  );
}
