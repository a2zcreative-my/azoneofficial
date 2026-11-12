"use client";

/* v1.272.0 - SALES -> PAYMENTS (the CEO, 10-11-2026: "COO, CCO and
   authorized sales staff can report payments. They must not self-finalize
   paid status. Every payment requires CEO verification.";
   claude/PAYMENT-VERIFICATION-AUDIT.md, answers P1-P9 as recommended).

   v1.282.0 - SALES PAYMENT VERIFICATION 3.0 (the CEO, 11-11-2026, "Proceed"
   on claude/PAYMENT-VERIFICATION-3.0-BLUEPRINT.md, P1-P9 as recommended;
   the two design references). The same server, the same rules - a new
   workspace on top of them:

     title row   Payment Verification, "Verification: Required", and the
                 owner's Settings (P2: the switch left the daily page; its
                 sheet warns how many reports are still waiting)
     four tiles  Pending CEO verification (and how many of those wait for an
                 independent evidence check), Verified this month, Verified
                 outstanding (pending never deducted), Partially paid
     four tabs   Needs My Verification, Invoice Balances, Payment History,
                 Audit Trail - one dataset each, a table on a desktop and
                 cards on a phone (one DOM, no sideways scroll)
     one action  per invoice (payment-parts.tsx actionFor): Report payment,
                 Report remaining payment, View pending payment, Review
                 payment - never a second report as the main button (D1)
     the sheet   amounts, the reported facts, the receipt, the evidence
                 review, the timeline and the decision at its foot. The
                 CEO's own report shows "Awaiting independent evidence
                 review" and NO Verify button until another person checked
                 the bank (D2; the API refuses it either way)
     reporting   three steps in one sheet: Details, Proof, Review

   Every rule is the server's (worker/src/payment-verify.ts); this screen
   only offers what it allows and shows success only after the server says so. */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, csrfFetch } from "@/lib/api";
import { compressImage } from "@/lib/compress-image";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { csvStampMyt, downloadCsv } from "@/lib/csv";
import { A2Z_CREATIVE, AZ_ONE } from "@/lib/issuers";
import { btnSm, btnSmDanger, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SideDrawer } from "@/components/ui/side-drawer";
import { AppIcon } from "@/components/ui/app-icon";
import { StageTimeline, type Stage } from "@/components/ui/stage-timeline";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { AmountSummary, Cell, ReceiptPreview, ReviewChip, SettlementChip, actionFor, isPendingState, reviewOf, settlementOf, type MainAction, type PayActor } from "@/components/portal/payment-parts";
import css from "./payments-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Caps { report: boolean; verify: boolean; evidence: boolean; switch: boolean; all: boolean }
interface Bank { id: number; name: string; bank: string; number_masked: string; company: string | null }
interface Rep {
  id: number; invoice_id: number; issuer_code: string; amount_cents: number; received_on: string; method: string; reference: string | null;
  over_cents: number; dup_of: number | null; state: string; reported_by: number; reported_at: string; evidence_by: number | null;
  decided_at: string | null; verified_cents: number | null; question: string | null; has_proof: boolean; mine: boolean; needs_evidence: boolean;
  doc_number?: string; customer?: string | null; reporter?: string | null; reporter_role?: string | null; salesperson?: string | null; total_cents?: number;
  note?: string | null; answer?: string | null; reason?: string | null; evidence_note?: string | null; evidence_name?: string | null; evidence_at?: string | null;
  decided_name?: string | null; bank_name?: string | null; verify_method?: string | null; dup_reason?: string | null; reverse_reason?: string | null;
}
interface OpenInv {
  id: number; doc_number: string; total_cents: number; customer: string | null; salesperson: string | null; salesperson_id?: number | null; company: string; created_at?: string;
  verified_cents: number; pending_cents: number; outstanding_cents: number; status: string; can_report: boolean;
}
interface Data {
  on: boolean; ready: boolean; can: Caps; banks: Bank[]; reports: Rep[]; invoices: OpenInv[];
  tiles: { pending_cents: number; pending_count: number; verified_month_cents: number; outstanding_cents: number; outstanding_invoices: number; partial_invoices: number };
}
interface Ev { id: number; invoice_id?: number; report_id: number | null; event: string; amount_cents: number | null; detail: string | null; created_at: string; actor: string | null; doc_number?: string | null }
interface Picture {
  invoice: { id: number; doc_number: string; customer: string | null; total_cents: number; payment_status: string | null; company: string; company_name: string; salesperson_id?: number | null; salesperson?: string | null };
  verified_cents: number; pending_cents: number; outstanding_cents: number; status: string; reports: Rep[]; events: Ev[]; can_report: boolean;
}
type Err = { error?: { message?: string; code?: string } };
type Tab = "needs" | "balances" | "history" | "audit";

const COMPANY: Record<string, string> = { a2z: "A2Z", azoo: "AZ ONE" };
const ROLE_WORD: Record<string, string> = { ceo: "CEO", coo: "COO", cco: "CCO", sales_marketing: "Sales" };
const EVENT_WORDS: Record<string, [string, string]> = {
  reported: ["Payment reported", "Bayaran dilapor"], proof_uploaded: ["Proof uploaded", "Bukti dimuat naik"],
  evidence_checked: ["Independent evidence review done", "Semakan bukti bebas selesai"], clarification_requested: ["Clarification requested", "Penjelasan diminta"],
  clarification_answered: ["Clarification answered", "Penjelasan dijawab"], verified: ["CEO verified payment", "CEO mengesahkan bayaran"],
  rejected: ["CEO rejected payment", "CEO menolak bayaran"], outstanding_updated: ["Outstanding updated", "Baki dikemas kini"],
  invoice_paid: ["Invoice paid - all payments verified", "Invois dibayar - semua bayaran disahkan"], reversed: ["Payment reversed", "Bayaran dibatalkan"],
};
const METHODS: [string, string, string][] = [["bank_transfer", "Bank transfer", "Pindahan bank"], ["online", "Online / DuitNow", "Dalam talian / DuitNow"], ["cheque", "Cheque", "Cek"], ["cash", "Cash", "Tunai"], ["other", "Other", "Lain-lain"]];
const methodWord = (m: string) => { const f = METHODS.find((x) => x[0] === m); return f ? L(f[1], f[2]) : m; };
const toCents = (s: string) => { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const msg = (r: { data: unknown }, fallback: string) => (r.data as Err | null)?.error?.message ?? fallback;
/** the account printed on the invoice's letterhead - what the customer was told to pay into (lib/issuers.ts) */
const letterhead = (company: string) => { const i = company === "a2z" ? A2Z_CREATIVE : AZ_ONE; return `${i.bank} (${i.bankHolder})`; };
/** v1.285.0 - whose sale a verified payment was, as recorded when the CEO decided it */
function saleWords(ev: Ev | undefined): string | null {
  if (!ev?.detail) return null;
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(ev.detail) as Record<string, unknown>; } catch { return null; }
  if (d.own_sale === true) return L("the CEO's own sale", "jualan CEO sendiri");
  if (typeof d.own_sale === "boolean") return d.salesperson ? L(`on behalf of ${String(d.salesperson)}`, `bagi pihak ${String(d.salesperson)}`) : L("no salesperson recorded", "tiada jurujual direkod");
  return null;
}
/** v1.285.0 - before the CEO clicks: whose sale this is */
const saleBanner = (salespersonId: number | null | undefined, salesperson: string | null | undefined, userId: number) =>
  salespersonId === userId ? L("This is your own sale.", "Ini jualan anda sendiri.")
    : salesperson ? L(`This is ${salesperson}'s sale - you are marking it paid on their behalf.`, `Ini jualan ${salesperson} - anda menandanya dibayar bagi pihak mereka.`)
    : L("No salesperson is recorded on this invoice.", "Tiada jurujual direkod pada invois ini.");
const whoWord = (r: Rep) => `${r.reporter ?? "-"}${r.reporter_role && ROLE_WORD[r.reporter_role] ? ` · ${ROLE_WORD[r.reporter_role]}` : ""}${r.mine ? ` ${L("(you)", "(anda)")}` : ""}`;

async function uploadProof(reportId: number, f: File): Promise<string | null> {
  let blob: Blob = f;
  if (f.type.startsWith("image/")) blob = await compressImage(f);
  if (blob.size > 8 * 1024 * 1024) return L("The proof is larger than 8 MB.", "Bukti melebihi 8 MB.");
  const type = f.type === "application/pdf" ? "application/pdf" : blob.type || "image/jpeg";
  const up = await csrfFetch(`/api/v1/staff/payment-reports/${reportId}/proof`, { method: "POST", headers: { "Content-Type": type }, body: blob });
  if (up.ok) return null;
  const j = (await up.json().catch(() => null)) as Err | null;
  return j?.error?.message ?? L("The proof was not attached.", "Bukti tidak dilampirkan.");
}

export function PaymentsPanel({ userId, onChanged, recordInvoiceId, onRecordOpened, viewInvoiceId, onViewOpened, reportTick = 0 }: {
  userId: number; onChanged?: () => void;
  /** v1.278.0 - opened from an invoice's Report payment in the documents list: its sheet opens at once */
  recordInvoiceId?: number | null; onRecordOpened?: () => void;
  /** v1.282.0 - opened from View pending payment / Review payment elsewhere in Sales: that invoice's sheet */
  viewInvoiceId?: number | null; onViewOpened?: () => void;
  /** v1.282.0 - the header's gold Report payment: each press opens the report sheet with its invoice picker */
  reportTick?: number;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>("needs");
  const [q, setQ] = useState("");
  const [bal, setBal] = useState<"all" | "unpaid" | "partial" | "waiting">("all");
  const [openInv, setOpenInv] = useState<number | null>(null);
  const [recordFor, setRecordFor] = useState<OpenInv | "pick" | null>(null);
  const [policy, setPolicy] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();

  useEffect(() => {
    let live = true;
    void api<Data>("/staff/payments").then((r) => {
      if (!live) return;
      if (r.ok && r.data) { setData(r.data); setFailed(false); } else setFailed(true);
    });
    return () => { live = false; };
  }, [tick]);
  const reload = () => { setTick((t) => t + 1); onChanged?.(); };
  /* the header's Report payment - the first render's 0 opens nothing */
  const firstTick = useRef(reportTick);
  useEffect(() => { if (reportTick !== firstTick.current) setRecordFor("pick"); }, [reportTick]);

  const invById = useMemo(() => new Map((data?.invoices ?? []).map((i) => [i.id, i])), [data]);
  const pendingReps = useMemo(() => (data?.reports ?? []).filter((r) => isPendingState(r.state)), [data]);
  const decided = useMemo(() => (data?.reports ?? []).filter((r) => !isPendingState(r.state)), [data]);

  if (failed) return <div className={card}><p className={css.empty}>{L("Payments could not be loaded.", "Bayaran tidak dapat dimuatkan.")}</p></div>;
  if (!data) return <div className={card}><SkelRows rows={4} /></div>;

  /* v1.278.0 - opened from an invoice's Report payment in the documents
     list: that invoice's sheet is open until it is closed or saved */
  const sheetFor = recordFor ?? (recordInvoiceId != null ? data.invoices.find((i) => i.id === recordInvoiceId && i.can_report) ?? null : null);
  /* v1.282.0 - opened from View pending payment elsewhere in Sales: that invoice's sheet, until it is closed */
  const drawerInv = openInv ?? viewInvoiceId ?? null;

  /* what is waiting for THIS person */
  const mineToAct = (r: Rep) =>
    (data.can.verify && (r.state === "reported" || r.state === "evidence_checked"))
    || (data.can.evidence && r.state === "reported" && !r.mine && r.needs_evidence)
    || (r.mine && r.state === "clarify");
  const reviewableInv = (invId: number) => pendingReps.some((r) => r.invoice_id === invId && mineToAct(r));
  const awaitingIndep = pendingReps.filter((r) => reviewOf(r) === "awaiting_independent").length;
  const canReportNow = data.on && data.can.report;
  /* v1.285.0 - the owner's Paid is final; the COO and CCO request it */
  const who: PayActor = data.can.verify ? "owner" : data.can.all ? "exec" : "staff";
  const act = (i: OpenInv): MainAction => actionFor({ ...i, can_report: canReportNow && i.can_report }, reviewableInv(i.id), who);
  const runAct = (i: OpenInv, a: MainAction) => (a.kind === "report" || a.kind === "report_remaining" ? setRecordFor(i) : setOpenInv(i.id));

  const needsLabel = data.can.verify ? L("Needs My Verification", "Perlu Pengesahan Saya") : L("Waiting for review", "Menunggu semakan");
  const tabs: [Tab, string, string, number | null][] = [
    ["needs", needsLabel, L("Pending", "Tertunda"), pendingReps.length || null],
    ["balances", L("Invoice Balances", "Baki Invois"), L("Balances", "Baki"), data.invoices.length || null],
    ["history", L("Payment History", "Sejarah Bayaran"), L("History", "Sejarah"), null],
    ["audit", L("Audit Trail", "Jejak Audit"), L("Audit", "Audit"), null],
  ];

  const shownInv = data.invoices.filter((i) => {
    if (bal === "unpaid" && i.verified_cents > 0) return false;
    if (bal === "partial" && !(i.verified_cents > 0)) return false;
    if (bal === "waiting" && !(i.pending_cents > 0)) return false;
    const s = q.trim().toLowerCase();
    return !s || `${i.doc_number} ${i.customer ?? ""} ${i.salesperson ?? ""}`.toLowerCase().includes(s);
  });
  const lastUpdate = (i: OpenInv) => {
    const r = data.reports.filter((x) => x.invoice_id === i.id).map((x) => x.reported_at).sort().at(-1);
    const at = r ?? i.created_at;
    return at ? dmyMYT(at).slice(0, 10) : "—";
  };
  const invReview = (invId: number) => { const r = pendingReps.find((x) => x.invoice_id === invId); return r ? reviewOf(r) : null; };
  const exportCsv = () => downloadCsv(`invoice-balances-${mytToday()}`, [
    [`Invoice balances - exported ${csvStampMyt()}`],
    ["Invoice", "Customer", "Company", "Total (RM)", "Verified (RM)", "Pending (RM)", "Verified outstanding (RM)", "Settlement", "Review"],
    ...shownInv.map((i) => [i.doc_number, i.customer ?? "", COMPANY[i.company] ?? i.company, (i.total_cents / 100).toFixed(2), (i.verified_cents / 100).toFixed(2), (i.pending_cents / 100).toFixed(2), (i.outstanding_cents / 100).toFixed(2),
      settlementOf(i.total_cents, i.verified_cents), invReview(i.id) ?? ""]),
  ]);

  return (
    <div className={css.stack}>
      {toastNode}
      <section className={`${card} ${css.head}`} aria-label={L("Payment verification", "Pengesahan bayaran")} data-testid="pay-head">
        <span className={css.well} aria-hidden="true"><AppIcon name="verify" /></span>
        <div className={css.headText}>
          <h2 className={css.h2}>{L("Payment Verification", "Pengesahan Bayaran")}</h2>
          <p className={css.meta}>{data.on
            ? L("Report customer payments with proof. A payment counts as money only after the CEO verifies it.", "Lapor bayaran pelanggan dengan bukti. Bayaran dikira wang hanya selepas CEO mengesahkannya.")
            : L("Off: payments are recorded the existing way (Mark paid, Confirm Paid).", "Mati: bayaran direkod seperti sedia ada (Tanda dibayar, Sahkan Dibayar).")}</p>
        </div>
        <span className={css.headRight}>
          <span className={`${data.on ? chipSmSuccess : chipSmNeutral} ${css.chip}`} data-testid="pay-policy">{data.on ? L("Verification: Required", "Pengesahan: Wajib") : L("Verification: Off", "Pengesahan: Mati")}</span>
          {data.can.switch && <button type="button" className={btnSm} onClick={() => setPolicy(true)}><AppIcon name="lock" />{L("Settings", "Tetapan")}</button>}
        </span>
      </section>

      <KpiRow label={L("Payments", "Bayaran")}>
        <KpiTile icon="pending" tone="gold" label={L("Pending CEO verification", "Menunggu pengesahan CEO")} value={fmtRM(data.tiles.pending_cents)}
          sub={L(`${data.tiles.pending_count} payment${data.tiles.pending_count === 1 ? "" : "s"}${awaitingIndep ? ` · ${awaitingIndep} awaiting independent review` : ""}`, `${data.tiles.pending_count} bayaran${awaitingIndep ? ` · ${awaitingIndep} menunggu semakan bebas` : ""}`)}
          onClick={() => setTab("needs")} />
        <KpiTile icon="verify" tone="green" label={L("Verified this month", "Disahkan bulan ini")} value={fmtRM(data.tiles.verified_month_cents)}
          sub={L("CEO-verified payments only", "Bayaran disahkan CEO sahaja")} onClick={() => setTab("history")} />
        <KpiTile icon="balance" tone="red" label={L("Verified outstanding", "Baki disahkan")} value={fmtRM(data.tiles.outstanding_cents)}
          sub={L(`${data.tiles.outstanding_invoices} invoice${data.tiles.outstanding_invoices === 1 ? "" : "s"} · pending not deducted`, `${data.tiles.outstanding_invoices} invois · tertunda tidak ditolak`)}
          onClick={() => { setBal("all"); setTab("balances"); }} />
        <KpiTile icon="money" tone="blue" label={L("Partially paid", "Dibayar separa")} value={data.tiles.partial_invoices}
          sub={L("Invoices with a verified part", "Invois dengan bahagian disahkan")} onClick={() => { setBal("partial"); setTab("balances"); }} />
      </KpiRow>

      <div className={`${card} ${css.tabs}`} role="tablist" aria-label={L("Payments", "Bayaran")}>
        {tabs.map(([k, word, short, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`pay-tab-${k}`} className={css.tab} onClick={() => setTab(k)}>
            <span className="erp-desktop-only">{word}</span><span className="erp-phone-only">{short}</span>
            {n ? <span className={css.tabN} aria-hidden="true">{n}</span> : null}
          </button>
        ))}
      </div>

      {!data.ready && <p className="erp-note erp-note-warning">{L("Run migration 0181 (PUSH.bat) to start payment verification.", "Jalankan migrasi 0181 (PUSH.bat) untuk memulakan pengesahan bayaran.")}</p>}

      {tab === "needs" && (
        <section className={`${card} ${css.sec}`} aria-label={needsLabel}>
          <div className={css.bar}>
            <div>
              <h3 className={css.h}>{L("Payments waiting for verification", "Bayaran menunggu pengesahan")}</h3>
              <p className={css.meta}>{data.can.verify
                ? L("Reported by Sales, the COO, the CCO or you. Your own reports need another person's evidence check first.", "Dilapor oleh Jualan, COO, CCO atau anda. Laporan anda sendiri perlu semakan bukti orang lain dahulu.")
                : L("Reported payments are not money until the CEO verifies them.", "Bayaran dilapor bukan wang sehingga CEO mengesahkannya.")}</p>
            </div>
            {pendingReps.length > 0 && <span className={css.sumPill}>{L(`${pendingReps.length} payment${pendingReps.length === 1 ? "" : "s"}`, `${pendingReps.length} bayaran`)} · {fmtRM(pendingReps.reduce((a, r) => a + r.amount_cents, 0))}</span>}
          </div>
          {pendingReps.length === 0 ? <p className={css.empty}>{L("Nothing is waiting for verification.", "Tiada apa menunggu pengesahan.")}</p> : (
            <div className={`${css.table} ${css.tNeeds}`} role="table" aria-label={L("Payments waiting for verification", "Bayaran menunggu pengesahan")}>
              <div className={css.thead} role="row">
                {[L("Invoice & customer", "Invois & pelanggan"), L("Reported", "Dilapor"), L("Invoice total", "Jumlah invois"), L("Verified", "Disahkan"), L("Outstanding", "Baki"), L("Submitted by", "Dihantar oleh"), L("Proof", "Bukti"), L("Review status", "Status semakan"), ""].map((h, n) => <span key={n} role="columnheader" className={n >= 1 && n <= 4 ? css.num : undefined}>{h}</span>)}
              </div>
              {pendingReps.map((r) => {
                const inv = invById.get(r.invoice_id);
                const mine = mineToAct(r);
                return (
                  <div key={r.id} role="row" className={`${css.tr} ${mine ? css.act : ""}`} data-testid="payment-row">
                    <Cell k={L("Invoice", "Invois")} className={css.cMain}>
                      <span className={css.title}>{r.doc_number} <span className={css.co}>{COMPANY[r.issuer_code] ?? r.issuer_code}</span></span>
                      <span className={css.sub}>{r.customer ?? "-"}{r.reference ? ` · ${L("ref", "ruj")} ${r.reference}` : ""}</span>
                    </Cell>
                    <Cell k={L("Reported", "Dilapor")} num><b>{fmtRM(r.amount_cents)}</b></Cell>
                    <Cell k={L("Invoice total", "Jumlah invois")} num className={css.dOnly}>{fmtRM(r.total_cents ?? inv?.total_cents ?? 0)}</Cell>
                    <Cell k={L("Verified", "Disahkan")} num className={css.dOnly}>{fmtRM(inv?.verified_cents ?? 0)}</Cell>
                    <Cell k={L("Outstanding", "Baki")} num className={css.dOnly}>{fmtRM(inv?.outstanding_cents ?? 0)}</Cell>
                    <Cell k={L("Submitted by", "Dihantar oleh")}><span>{whoWord(r)}</span><span className={css.sub}>{dmy(r.received_on)}</span></Cell>
                    <Cell k={L("Proof", "Bukti")}>{r.has_proof ? <span className={css.proofTag}><AppIcon name="attach" />{L("Receipt", "Resit")}</span> : <span className={chipSmNeutral}>{L("No proof", "Tiada bukti")}</span>}</Cell>
                    <Cell k={L("Review status", "Status semakan")} className={css.cWide}>
                      <span className={css.flags}>
                        <ReviewChip r={reviewOf(r)} />
                        {r.dup_of !== null && <span className={chipSmDanger}>{L("Possible duplicate", "Mungkin pendua")}</span>}
                        {r.over_cents > 0 && <span className={chipSmWarn}>{L(`${fmtRM(r.over_cents)} over`, `${fmtRM(r.over_cents)} lebih`)}</span>}
                      </span>
                    </Cell>
                    <span role="cell" className={css.cAct}>
                      <button type="button" className={mine ? btnSmPrimary : btnSm} onClick={() => setOpenInv(r.invoice_id)}>
                        {mine ? (r.state === "clarify" ? L("Answer", "Jawab") : data.can.verify ? L("Review", "Semak") : L("Check evidence", "Semak bukti")) : L("Review", "Semak")}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {data.can.verify && awaitingIndep > 0 && <p className={css.note}><AppIcon name="info" />{L("Verify unlocks on your own report after the COO confirms the money in the bank. Pending amounts are never deducted from verified outstanding.", "Sahkan dibuka pada laporan anda selepas COO mengesahkan wang dalam bank. Amaun tertunda tidak ditolak daripada baki disahkan.")}</p>}
        </section>
      )}

      {tab === "balances" && (
        <section className={`${card} ${css.sec}`} aria-label={L("Invoice Balances", "Baki Invois")}>
          <div className={css.bar}>
            <div>
              <h3 className={css.h}>{L("Invoice Balances", "Baki Invois")}</h3>
              <p className={css.meta}>{data.can.all ? L("Every unpaid invoice, with verified and pending money kept apart.", "Setiap invois belum dibayar, wang disahkan dan tertunda diasingkan.") : L("Your unpaid invoices, with verified and pending money kept apart.", "Invois anda yang belum dibayar, wang disahkan dan tertunda diasingkan.")}</p>
            </div>
            <div className={css.filters}>
              <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search invoice or customer…", "Cari invois atau pelanggan…")} aria-label={L("Search invoices", "Cari invois")} />
              <select className={selectClassSm} value={bal} onChange={(e) => setBal(e.target.value as typeof bal)} aria-label={L("Show", "Tunjuk")}>
                <option value="all">{L("All status", "Semua status")}</option>
                <option value="unpaid">{L("Unpaid", "Belum dibayar")}</option>
                <option value="partial">{L("Partially paid", "Dibayar separa")}</option>
                <option value="waiting">{L("Waiting for review", "Menunggu semakan")}</option>
              </select>
              <button type="button" className={btnSm} onClick={exportCsv} disabled={!shownInv.length}><AppIcon name="download" />{L("Export", "Eksport")}</button>
            </div>
          </div>
          {shownInv.length === 0 ? <p className={css.empty}>{L("No unpaid invoices here.", "Tiada invois belum dibayar di sini.")}</p> : (
            <div className={`${css.table} ${css.tBal}`} role="table" aria-label={L("Invoice Balances", "Baki Invois")}>
              <div className={css.thead} role="row">
                {[L("Invoice & customer", "Invois & pelanggan"), L("Total", "Jumlah"), L("Verified", "Disahkan"), L("Pending", "Tertunda"), L("Outstanding", "Baki"), L("Settlement", "Penyelesaian"), L("Review", "Semakan"), L("Last update", "Kemas kini"), ""].map((h, n) => <span key={n} role="columnheader" className={n >= 1 && n <= 4 ? css.num : undefined}>{h}</span>)}
              </div>
              {shownInv.map((i) => {
                const a = act(i);
                const rv = invReview(i.id);
                return (
                  <div key={i.id} role="row" className={css.tr} data-testid="inv-row">
                    <Cell k={L("Invoice", "Invois")} className={css.cMain}>
                      <span className={css.title}><button type="button" className={css.link} onClick={() => setOpenInv(i.id)}>{i.doc_number}</button><span className={css.co}>{COMPANY[i.company] ?? i.company}</span></span>
                      <span className={css.sub}>{i.customer ?? "-"}{i.salesperson ? ` · ${i.salesperson}` : ""}</span>
                    </Cell>
                    <Cell k={L("Total", "Jumlah")} num>{fmtRM(i.total_cents)}</Cell>
                    <Cell k={L("Verified", "Disahkan")} num>{fmtRM(i.verified_cents)}</Cell>
                    <Cell k={L("Pending", "Tertunda")} num>{fmtRM(i.pending_cents)}</Cell>
                    <Cell k={L("Outstanding", "Baki")} num><b>{fmtRM(i.outstanding_cents)}</b></Cell>
                    <Cell k={L("Settlement", "Penyelesaian")}><SettlementChip s={settlementOf(i.total_cents, i.verified_cents)} testId="inv-settlement" /></Cell>
                    <Cell k={L("Review", "Semakan")}>{rv ? <ReviewChip r={rv} testId="inv-review" /> : <span className={css.sub}>—</span>}</Cell>
                    <Cell k={L("Last update", "Kemas kini")}>{lastUpdate(i)}</Cell>
                    <span role="cell" className={css.cAct}>
                      {a.kind !== "none" && <button type="button" className={a.kind === "report" || a.kind === "report_remaining" || a.kind === "review" ? btnSmPrimary : btnSm} data-testid="inv-action" data-kind={a.kind} onClick={() => runAct(i, a)}>{a.label}</button>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "history" && (
        <section className={`${card} ${css.sec}`} aria-label={L("Payment History", "Sejarah Bayaran")}>
          <h3 className={css.h}>{L("Payment History", "Sejarah Bayaran")}</h3>
          <p className={css.meta}>{L("Decided payments: verified, rejected and reversed. Nothing is deleted.", "Bayaran yang diputuskan: disahkan, ditolak dan dibatalkan. Tiada apa dipadam.")}</p>
          {decided.length === 0 ? <p className={css.empty}>{L("No decided payments yet.", "Belum ada bayaran diputuskan.")}</p> : (
            <div className={`${css.table} ${css.tHist}`} role="table" aria-label={L("Payment History", "Sejarah Bayaran")}>
              <div className={css.thead} role="row">
                {[L("Invoice & customer", "Invois & pelanggan"), L("Amount", "Amaun"), L("Status", "Status"), L("Submitted by", "Dihantar oleh"), L("Decided", "Diputuskan"), ""].map((h, n) => <span key={n} role="columnheader" className={n === 1 ? css.num : undefined}>{h}</span>)}
              </div>
              {decided.map((r) => (
                <div key={r.id} role="row" className={css.tr} data-testid="payment-row">
                  <Cell k={L("Invoice", "Invois")} className={css.cMain}><span className={css.title}>{r.doc_number} <span className={css.co}>{COMPANY[r.issuer_code] ?? r.issuer_code}</span></span><span className={css.sub}>{r.customer ?? "-"}</span></Cell>
                  <Cell k={L("Amount", "Amaun")} num><b>{fmtRM(r.state === "verified" ? r.verified_cents ?? r.amount_cents : r.amount_cents)}</b></Cell>
                  <Cell k={L("Status", "Status")}><ReviewChip r={reviewOf(r)} /></Cell>
                  <Cell k={L("Submitted by", "Dihantar oleh")}>{whoWord(r)}</Cell>
                  <Cell k={L("Decided", "Diputuskan")}>{r.decided_at ? dmyMYT(r.decided_at) : "—"}</Cell>
                  <span role="cell" className={css.cAct}><button type="button" className={btnSm} onClick={() => setOpenInv(r.invoice_id)}>{L("View", "Lihat")}</button></span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "audit" && <AuditTrail onOpen={(id) => setOpenInv(id)} />}

      {sheetFor && <RecordSheet inv={sheetFor === "pick" ? null : sheetFor} invoices={data.invoices.filter((i) => i.can_report && canReportNow)} who={who} banks={data.banks} userId={userId}
        onClose={() => { setRecordFor(null); onRecordOpened?.(); }}
        onDone={(m) => { setRecordFor(null); onRecordOpened?.(); toast(L("Saved", "Disimpan"), m); reload(); }}
        onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />}
      {drawerInv !== null && <InvoiceDrawer key={drawerInv} invId={drawerInv} data={data} userId={userId} onClose={() => { setOpenInv(null); onViewOpened?.(); }}
        onReport={(i) => { setOpenInv(null); onViewOpened?.(); setRecordFor(i); }}
        onDone={(m) => { toast(L("Saved", "Disimpan"), m); reload(); }}
        onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />}
      {policy && <PolicySheet data={data} pending={pendingReps.length} onClose={() => setPolicy(false)}
        onDone={(m) => { setPolicy(false); toast(L("Saved", "Disimpan"), m); reload(); }}
        onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />}
    </div>
  );
}

/** v1.282.0 - every payment event across invoices, newest first (read-only, GET /staff/payments/events). */
function AuditTrail({ onOpen }: { onOpen: (invoiceId: number) => void }) {
  const [rows, setRows] = useState<Ev[] | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ events: Ev[] }>("/staff/payments/events?limit=100").then((r) => {
      if (!live) return;
      if (r.ok && r.data) setRows(r.data.events ?? []); else setGone(true);
    });
    return () => { live = false; };
  }, []);
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Audit Trail", "Jejak Audit")} data-testid="pay-audit">
      <h3 className={css.h}>{L("Audit Trail", "Jejak Audit")}</h3>
      <p className={css.meta}>{L("Every payment event, newest first. The history is append-only: nothing here can be changed or removed.", "Setiap peristiwa bayaran, terbaru dahulu. Sejarah hanya ditambah: tiada apa boleh diubah atau dibuang.")}</p>
      {gone ? <p className={css.empty}>{L("The audit list is not available yet - open an invoice to read its full timeline.", "Senarai audit belum tersedia - buka invois untuk membaca garis masanya.")}</p>
        : !rows ? <SkelRows rows={4} />
          : rows.length === 0 ? <p className={css.empty}>{L("No payment events yet.", "Belum ada peristiwa bayaran.")}</p> : (
            <ol className={css.audit}>
              {rows.map((e) => {
                const w = EVENT_WORDS[e.event] ?? [e.event, e.event];
                return (
                  <li key={e.id} className={css.auditRow}>
                    <span className={css.sub}>{dmyMYT(e.created_at)}</span>
                    <span><b>{L(...w)}</b>{e.amount_cents ? ` · ${fmtRM(e.amount_cents)}` : ""}</span>
                    <span className={css.sub}>{e.actor ?? L("System", "Sistem")}</span>
                    {e.invoice_id ? <button type="button" className={css.link} onClick={() => onOpen(e.invoice_id!)}>{e.doc_number ?? `#${e.invoice_id}`}</button> : <span />}
                  </li>
                );
              })}
            </ol>
          )}
    </section>
  );
}

/** v1.282.0 (P2) - the owner's verification policy, off the daily page. The rule is unchanged: owner, reason, code. */
function PolicySheet({ data, pending, onClose, onDone, onFail }: { data: Data; pending: number; onClose: () => void; onDone: (m: string) => void; onFail: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api<Err>("/staff/payments/settings", { method: "PUT", body: JSON.stringify({ on: !data.on, reason: reason.trim(), totp: code }) });
    setBusy(false); setCode("");
    if (!r.ok) { onFail(msg(r, L("Not changed", "Tidak diubah"))); return; }
    onDone(!data.on ? L("Payment verification is on", "Pengesahan bayaran dihidupkan") : L("Payment verification is off", "Pengesahan bayaran dimatikan"));
  };
  const word = data.on ? L("Switch off", "Matikan") : L("Switch on", "Hidupkan");
  return (
    <SideDrawer open onClose={onClose} title={L("Verification policy", "Dasar pengesahan")} subtitle={L("Owner only · reason and authenticator code · audited", "Pemilik sahaja · sebab dan kod pengesah · diaudit")}
      dirty={reason.trim().length > 0}
      footer={<div className={css.foot}>
        <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={data.on ? btnSmDanger : btnSmPrimary} disabled={busy || reason.trim().length < 5 || code.length !== 6} onClick={() => void save()}>{word}</button>
      </div>}>
      <div className={css.formCol} data-testid="policy-sheet">
        <p>{L("Payment verification is", "Pengesahan bayaran")} <b>{data.on ? L("on", "hidup") : L("off", "mati")}</b>.</p>
        {data.on && <p className="erp-note erp-note-danger">{L("Switching off lets invoices be marked paid without the CEO's verification. It does not verify anything that is waiting.", "Mematikan membolehkan invois ditanda dibayar tanpa pengesahan CEO. Ia tidak mengesahkan apa-apa yang menunggu.")}
          {pending > 0 ? ` ${L(`${pending} reported payment${pending === 1 ? " is" : "s are"} still waiting for a decision.`, `${pending} bayaran dilapor masih menunggu keputusan.`)}` : ""}</p>}
        <label className={css.field}>{L("Reason", "Sebab")}<input className={inputClassSm} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        <label className={css.field}>{L("Authenticator code", "Kod pengesah")}<input className={inputClassSm} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
      </div>
    </SideDrawer>
  );
}

/** Report payment: Details, Proof, Review - one sheet, three steps. */
function RecordSheet({ inv: fixed, invoices, additional = false, who = "staff", banks = [], userId = 0, onClose, onDone, onFail }: {
  inv: OpenInv | null; invoices: OpenInv[]; additional?: boolean;
  /** v1.285.0 - "owner": the CEO's Mark paid is final (report, then his own verify, in one go) */
  who?: PayActor; banks?: Bank[]; userId?: number;
  onClose: () => void; onDone: (m: string) => void; onFail: (m: string) => void;
}) {
  const owner = who === "owner";
  const [pick, setPick] = useState<number | "">(fixed?.id ?? "");
  const inv = fixed ?? invoices.find((i) => i.id === pick) ?? null;
  const left = inv ? Math.max(0, inv.outstanding_cents - inv.pending_cents) : 0;
  const extra = additional || (!!inv && inv.pending_cents > 0 && left === 0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState(left ? (left / 100).toFixed(2) : "");
  const [on, setOn] = useState(mytToday());
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const companyBanks = inv ? banks.filter((b) => b.company === inv.company) : [];
  const [bank, setBank] = useState<number | "">(companyBanks.length === 1 ? companyBanks[0]!.id : "");
  const [vm, setVm] = useState("bank_statement");
  const [code, setCode] = useState("");
  const cents = toCents(amount);
  const detailsOk = !!inv && cents > 0 && !!on && (method === "cash" || ref.trim().length >= 3) && (!extra || sure) && (!owner || bank !== "");
  const full = !!inv && cents >= left && left > 0;
  const send = async () => {
    if (!inv) return;
    setBusy(true);
    const r = await api<{ id?: number; over_cents?: number; possible_duplicate?: boolean } & Err>(`/staff/docs/${inv.id}/payment-reports`, {
      method: "POST", body: JSON.stringify({ amount_cents: cents, received_on: on, method, reference: ref.trim(), note: note.trim() || undefined }),
    });
    if (!r.ok || !r.data?.id) { setBusy(false); onFail(msg(r, L("Not reported - try again", "Tidak dilapor - cuba lagi"))); return; }
    const bad = file ? await uploadProof(r.data.id, file) : null;
    if (owner) {
      /* v1.285.0 - the CEO's own payment: he verifies it himself, now; nobody else checks it */
      const v = await api<Err & { invoice_paid?: boolean }>(`/staff/payment-reports/${r.data.id}/verify`, {
        method: "POST", body: JSON.stringify({ bank_id: bank === "" ? null : bank, verify_method: vm, amount_cents: Math.min(cents, inv.outstanding_cents), totp: code }),
      });
      setBusy(false); setCode("");
      if (!v.ok) { onFail(L(`Recorded, but not marked paid: ${msg(v, "try again")} Open the invoice to finish.`, `Direkod, tetapi belum ditanda dibayar: ${msg(v, "cuba lagi")} Buka invois untuk selesaikan.`)); onDone(L("Payment recorded", "Bayaran direkod")); return; }
      onDone(v.data?.invoice_paid ? L(`${inv.doc_number} marked paid`, `${inv.doc_number} ditanda dibayar`) : L("Payment recorded as received", "Bayaran direkod sebagai diterima"));
      return;
    }
    setBusy(false);
    if (bad) { onFail(L(`Reported, but the proof failed: ${bad} Open the invoice to attach it again.`, `Dilapor, tetapi bukti gagal: ${bad} Buka invois untuk melampirkannya semula.`)); onDone(L("Payment reported", "Bayaran dilapor")); return; }
    onDone(r.data.possible_duplicate
      ? L("Reported - this reference was used before, the CEO will check it", "Dilapor - rujukan ini pernah digunakan, CEO akan menyemaknya")
      : L("Payment reported - waiting for verification", "Bayaran dilapor - menunggu pengesahan"));
  };
  const STEPS: [1 | 2 | 3, string][] = [[1, L("Details", "Butiran")], [2, L("Proof", "Bukti")], [3, L("Review", "Semak")]];
  return (
    <SideDrawer open onClose={onClose} full dirty={!!ref.trim() || !!file || !!note.trim()}
      title={owner ? (inv ? L(`Mark paid - ${inv.doc_number}`, `Tanda dibayar - ${inv.doc_number}`) : L("Mark paid", "Tanda dibayar"))
        : who === "exec" ? (inv ? L(`Request paid - ${inv.doc_number}`, `Mohon tanda dibayar - ${inv.doc_number}`) : L("Request paid", "Mohon tanda dibayar"))
        : inv ? L(`Report payment - ${inv.doc_number}`, `Lapor bayaran - ${inv.doc_number}`) : L("Report payment", "Lapor bayaran")}
      subtitle={inv ? L(`${inv.customer ?? ""} · outstanding ${fmtRM(inv.outstanding_cents)}${inv.pending_cents ? ` · ${fmtRM(inv.pending_cents)} pending` : ""}`, `${inv.customer ?? ""} · baki ${fmtRM(inv.outstanding_cents)}${inv.pending_cents ? ` · ${fmtRM(inv.pending_cents)} tertunda` : ""}`) : undefined}
      footer={<div className={css.foot}>
        {step === 1 ? <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
          : <button type="button" className={btnSmQuiet} onClick={() => setStep((s) => (s - 1) as 1 | 2)}>{L("Back", "Kembali")}</button>}
        {step === 1 && <button type="button" className={css.btnGold} disabled={!detailsOk} onClick={() => setStep(2)}>{L("Next: proof", "Seterusnya: bukti")}</button>}
        {step === 2 && <button type="button" className={css.btnGold} disabled={!file && !owner} onClick={() => setStep(3)}>{owner && !file ? L("Next: review (no proof)", "Seterusnya: semak (tanpa bukti)") : L("Next: review", "Seterusnya: semak")}</button>}
        {step === 3 && <button type="button" className={css.btnGold} data-testid="record-send" disabled={busy || !detailsOk || (!file && !owner) || (owner && code.length !== 6)} onClick={() => void send()}>
          {busy ? L("Sending…", "Menghantar…") : owner ? (full ? L("Mark paid", "Tanda dibayar") : L("Record as received", "Rekod sebagai diterima")) : who === "exec" && full ? L("Request paid", "Mohon tanda dibayar") : L("Report payment", "Lapor bayaran")}
        </button>}
      </div>}>
      <ol className={css.steps} aria-label={L("Steps", "Langkah")}>
        {STEPS.map(([n, w]) => <li key={n} className={step === n ? css.stepOn : step > n ? css.stepDone : undefined} aria-current={step === n ? "step" : undefined}><span>{n}</span>{w}</li>)}
      </ol>
      {step === 1 && (
        <div className={css.formCol}>
          {!fixed && (
            <label className={css.field}>{L("Invoice", "Invois")}
              <select className={selectClassSm} value={pick} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : ""; setPick(id); const i = invoices.find((x) => x.id === id); const l = i ? Math.max(0, i.outstanding_cents - i.pending_cents) : 0; setAmount(l ? (l / 100).toFixed(2) : ""); }}>
                <option value="">{L("Choose the invoice", "Pilih invois")}</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.doc_number} · {i.customer ?? ""} · {fmtRM(i.outstanding_cents)}</option>)}
              </select>
            </label>
          )}
          {inv && <p className={css.sub}>{L(`Outstanding ${fmtRM(inv.outstanding_cents)}`, `Baki ${fmtRM(inv.outstanding_cents)}`)} · {inv.pending_cents ? L(`${fmtRM(inv.pending_cents)} already reported, waiting`, `${fmtRM(inv.pending_cents)} sudah dilapor, menunggu`) : L("nothing pending", "tiada tertunda")}</p>}
          {extra && inv && (
            <div className="erp-note erp-note-warning" data-testid="additional-warning">
              {L(`The whole outstanding ${fmtRM(inv.outstanding_cents)} is already reported and waiting. Report another payment only if the customer really paid again (a second transfer, with its own reference).`, `Seluruh baki ${fmtRM(inv.outstanding_cents)} sudah dilapor dan menunggu. Lapor bayaran lain hanya jika pelanggan benar-benar membayar lagi (pindahan kedua, dengan rujukannya sendiri).`)}
              <label className={css.check}><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> {L("This is a different payment, with its own reference", "Ini bayaran berlainan, dengan rujukannya sendiri")}</label>
            </div>
          )}
          <label className={css.field}>{L("Amount received (RM)", "Amaun diterima (RM)")}<input className={inputClassSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          {cents > left && left > 0 && <p className="erp-note erp-note-warning">{L(`More than the ${fmtRM(left)} left - it will be flagged for review.`, `Melebihi baki ${fmtRM(left)} - ia akan ditanda untuk semakan.`)}</p>}
          <label className={css.field}>{L("Received on", "Diterima pada")}<input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} /></label>
          <label className={css.field}>{L("Method", "Kaedah")}<select className={selectClassSm} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
          <label className={css.field}>{method === "cash" ? L("Receipt number (optional)", "Nombor resit (pilihan)") : L("Bank or payment reference", "Rujukan bank atau bayaran")}<input className={inputClassSm} value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} placeholder={L("As printed on the bank slip", "Seperti dicetak pada slip bank")} /></label>
          {inv && <p className={css.note}><AppIcon name="info" />{L("Customer was told to pay into", "Pelanggan diminta membayar ke")} {letterhead(inv.company)}.</p>}
          {owner && inv && (<>
            <label className={css.field}>{L("Received in account", "Diterima dalam akaun")}
              <select className={selectClassSm} value={bank} onChange={(e) => setBank(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{L("Choose the account", "Pilih akaun")}</option>
                {banks.map((b) => <option key={b.id} value={b.id} disabled={b.company !== inv.company}>{b.name} {b.number_masked} {b.company ? `(${COMPANY[b.company] ?? b.company})` : L("(no company yet)", "(tiada syarikat lagi)")}</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Where you saw the money", "Di mana anda melihat wang")}
              <select className={selectClassSm} value={vm} onChange={(e) => setVm(e.target.value)}>
                <option value="bank_statement">{L("Bank statement", "Penyata bank")}</option>
                <option value="bank_app">{L("Bank app / online banking", "Aplikasi bank / perbankan dalam talian")}</option>
              </select>
            </label>
          </>)}
        </div>
      )}
      {step === 2 && (
        <div className={css.formCol}>
          <label className={css.field}>{owner ? L("Proof (optional for you) - PDF, JPEG or PNG", "Bukti (pilihan untuk anda) - PDF, JPEG atau PNG") : L("Proof (transfer slip, receipt) - PDF, JPEG or PNG", "Bukti (slip pindahan, resit) - PDF, JPEG atau PNG")}<input className={inputClassSm} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          {file && <p className={css.sub}>{file.name}</p>}
          <label className={css.field}>{L("Remarks (optional)", "Catatan (pilihan)")}<textarea className={textareaClass} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
      )}
      {step === 3 && inv && (
        <div className={css.formCol} data-testid="report-review">
          <dl className={css.facts}>
            <div><dt>{L("Invoice", "Invois")}</dt><dd>{inv.doc_number}</dd></div>
            <div><dt>{L("Amount", "Amaun")}</dt><dd>{fmtRM(cents)}</dd></div>
            <div><dt>{L("Received on", "Diterima pada")}</dt><dd>{dmy(on)}</dd></div>
            <div><dt>{L("Method", "Kaedah")}</dt><dd>{methodWord(method)}</dd></div>
            {ref.trim() && <div><dt>{L("Reference", "Rujukan")}</dt><dd>{ref.trim()}</dd></div>}
            <div><dt>{L("Proof", "Bukti")}</dt><dd>{file?.name ?? "-"}</dd></div>
            {owner && <div><dt>{L("Received in", "Diterima dalam")}</dt><dd>{banks.find((b) => b.id === bank)?.name ?? "-"}</dd></div>}
          </dl>
          {owner ? (<>
            <p className="erp-note" data-testid="sale-banner"><b>{saleBanner(inv.salesperson_id, inv.salesperson, userId)}</b></p>
            <p className="erp-note">{full
              ? L(`Your Paid is final: ${inv.doc_number} turns Paid now. Cash is booked once and commission follows the existing rules. The COO and CCO are told, for the record.`, `Tanda dibayar anda muktamad: ${inv.doc_number} menjadi Dibayar sekarang. Tunai dibukukan sekali dan komisen mengikut peraturan sedia ada. COO dan CCO dimaklumkan, untuk rekod.`)
              : L(`This records ${fmtRM(Math.min(cents, inv.outstanding_cents))} as received now; ${inv.doc_number} stays partly paid until the rest arrives.`, `Ini merekod ${fmtRM(Math.min(cents, inv.outstanding_cents))} sebagai diterima sekarang; ${inv.doc_number} kekal dibayar sebahagian sehingga baki diterima.`)}</p>
            <label className={css.field}>{L("Authenticator code", "Kod pengesah")}<input className={inputClassSm} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
          </>) : (
            <p className="erp-note">{who === "exec" && full
              ? L("This requests Paid. The invoice turns Paid only when the CEO verifies it; until then it is not counted as received.", "Ini memohon tanda Dibayar. Invois menjadi Dibayar hanya apabila CEO mengesahkannya; sehingga itu ia tidak dikira diterima.")
              : L("This reports the payment. It is not counted as received, and the invoice stays unpaid, until the CEO verifies it.", "Ini melaporkan bayaran. Ia tidak dikira diterima, dan invois kekal belum dibayar, sehingga CEO mengesahkannya.")}</p>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

type Mode = "verify" | "reject" | "clarify" | "evidence" | "reverse" | "answer" | "proof";

/** One invoice: its figures, its payments, the actions this person may take, the timeline. */
function InvoiceDrawer({ invId, data, userId, onClose, onReport, onDone, onFail }: { invId: number; data: Data; userId: number; onClose: () => void; onReport: (i: OpenInv) => void; onDone: (m: string) => void; onFail: (m: string) => void }) {
  const [pic, setPic] = useState<Picture | null>(null);
  const [tick, setTick] = useState(0);
  const [act, setAct] = useState<{ rid: number; mode: Mode } | null>(null);
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [bank, setBank] = useState<number | "">("");
  const [vm, setVm] = useState("bank_statement");
  const [amt, setAmt] = useState("");
  const [dup, setDup] = useState("");
  const [checked, setChecked] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  /* the sticky actions open the form inside the payment's card: bring it
     into view so the person sees what they are about to confirm */
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (act) requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }, [act]);

  useEffect(() => {
    let live = true;
    void api<Picture>(`/staff/docs/${invId}/payment-reports`).then((r) => { if (live && r.ok && r.data) setPic(r.data); });
    return () => { live = false; };
  }, [invId, tick]);

  const start = (rid: number, mode: Mode, rep?: Rep) => {
    setAct({ rid, mode }); setText(""); setCode(""); setDup(""); setChecked(false); setFile(null);
    if (mode === "verify" && rep && pic) {
      setAmt((Math.min(rep.amount_cents, pic.outstanding_cents) / 100).toFixed(2));
      const banks = data.banks.filter((b) => b.company === pic.invoice.company);
      setBank(banks.length === 1 ? banks[0]!.id : "");
    }
  };
  const run = async () => {
    if (!act) return;
    setBusy(true);
    let r: { ok: boolean; data: unknown };
    if (act.mode === "proof") {
      const bad = file ? await uploadProof(act.rid, file) : L("Choose a file.", "Pilih fail.");
      r = { ok: !bad, data: bad ? { error: { message: bad } } : null };
    } else {
      const body: Record<string, unknown> =
        act.mode === "verify" ? { bank_id: bank === "" ? null : bank, verify_method: vm, amount_cents: toCents(amt), dup_reason: dup.trim() || undefined, totp: code }
        : act.mode === "reject" ? { reason: text.trim(), totp: code }
        : act.mode === "reverse" ? { reason: text.trim(), totp: code }
        : act.mode === "clarify" ? { question: text.trim() }
        : act.mode === "answer" ? { answer: text.trim() }
        : { note: text.trim(), checked, totp: code };
      r = await api<Err>(`/staff/payment-reports/${act.rid}/${act.mode}`, { method: "POST", body: JSON.stringify(body) });
    }
    setBusy(false); setCode("");
    if (!r.ok) { onFail(msg(r, L("Not saved - try again", "Tidak disimpan - cuba lagi"))); return; }
    const done: Record<Mode, [string, string]> = {
      verify: ["Payment verified", "Bayaran disahkan"], reject: ["Payment rejected", "Bayaran ditolak"], clarify: ["Question sent", "Soalan dihantar"],
      evidence: ["Bank evidence confirmed", "Bukti bank disahkan"], reverse: ["Payment reversed", "Bayaran dibatalkan"], answer: ["Answer sent", "Jawapan dihantar"], proof: ["Proof attached", "Bukti dilampirkan"],
    };
    setAct(null); setTick((t) => t + 1);
    onDone(L(...done[act.mode]));
  };

  const needsCode = act && ["verify", "reject", "reverse", "evidence"].includes(act.mode);
  const ready = act && !busy && (!needsCode || code.length === 6) && (
    act.mode === "verify" ? bank !== "" && toCents(amt) > 0
    : act.mode === "evidence" ? checked && text.trim().length >= 5
    : act.mode === "proof" ? !!file
    : act.mode === "clarify" ? text.trim().length >= 5
    : act.mode === "answer" ? text.trim().length >= 3
    : text.trim().length >= 10);

  /* the decision for the first payment that waits, pinned at the foot -
     Verify (gold) only where the 1.272 rule allows it; on the reporter's
     own report the foot says what it waits for instead (D2) */
  const isPending = (r: Rep) => ["reported", "evidence_checked"].includes(r.state);
  /* v1.285.0 - the CEO verifies any waiting payment, his own included: nobody else checks his */
  const mayVerify = (r: Rep) => data.can.verify && isPending(r);
  const lead = pic && data.can.verify ? pic.reports.find((r) => isPending(r)) ?? null : null;
  const evLead = pic && data.can.evidence && !lead ? pic.reports.find((r) => r.state === "reported" && r.reported_by !== userId && r.needs_evidence) ?? null : null;

  const timeline: Stage[] = (pic?.events ?? []).map((e) => {
    const w = EVENT_WORDS[e.event] ?? [e.event, e.event];
    let d: Record<string, unknown> = {};
    try { d = e.detail ? JSON.parse(e.detail) as Record<string, unknown> : {}; } catch { d = {}; }
    const note = (d.reason ?? d.question ?? d.answer ?? d.note) as string | undefined;
    return {
      key: String(e.id), state: e.event === "rejected" ? "rejected" : e.event === "reversed" ? "returned" : "done",
      title: `${L(...w)}${e.amount_cents ? ` · ${fmtRM(e.amount_cents)}` : ""}${e.event === "verified" && saleWords(e) ? ` · ${saleWords(e)}` : ""}`,
      sub: `${e.actor ?? L("System", "Sistem")} · ${dmyMYT(e.created_at)}`,
      note: note ? String(note) : undefined,
    };
  });
  /* what still has to happen - the steps ahead, never written as history */
  const waiting = pic?.reports.find((r) => isPendingState(r.state)) ?? null;
  if (pic && waiting && pic.invoice.payment_status !== "paid") {
    const rv = reviewOf(waiting);
    if (rv === "awaiting_independent") timeline.push({ key: "next-ev", state: "now", title: L("Independent evidence review", "Semakan bukti bebas"), sub: L("Waiting for the COO", "Menunggu COO") });
    if (rv === "clarify") timeline.push({ key: "next-q", state: "now", title: L("Clarification required", "Penjelasan diperlukan"), sub: L("Waiting for the reporter's answer", "Menunggu jawapan pelapor") });
    timeline.push({ key: "next-ceo", state: rv === "pending_ceo" ? "now" : "todo", title: L("CEO verification", "Pengesahan CEO"), sub: rv === "pending_ceo" ? L("Waiting for the CEO", "Menunggu CEO") : L("After the evidence check", "Selepas semakan bukti") });
    timeline.push({ key: "next-paid", state: "todo", title: L("Invoice settlement", "Penyelesaian invois"), sub: L(`Paid when verified money reaches ${fmtRM(pic.invoice.total_cents)}`, `Dibayar apabila wang disahkan mencapai ${fmtRM(pic.invoice.total_cents)}`) });
  }

  const openRow = data.invoices.find((i) => i.id === invId) ?? null;
  const left = pic ? Math.max(0, pic.outstanding_cents - pic.pending_cents) : 0;
  const reportable = !!pic && !!openRow && data.on && pic.can_report && pic.outstanding_cents > 0;
  const lockWords = L("Verify after the COO's check", "Sahkan selepas semakan COO");

  return (
    <SideDrawer open onClose={onClose} wide full title={L("Payment verification", "Pengesahan bayaran")}
      subtitle={pic ? `${pic.invoice.doc_number} · ${pic.invoice.customer ?? ""} · ${pic.invoice.company_name}` : undefined}
      footer={act ? undefined : lead ? (
        <div className={css.footActs} data-testid="payment-decide">
          {mayVerify(lead)
            ? <button type="button" className={css.btnVerify} onClick={() => start(lead.id, "verify", lead)}><AppIcon name="verify" />{L("Verify payment", "Sahkan bayaran")}</button>
            : <p className={css.lock} data-testid="verify-locked"><AppIcon name="lock" />{lockWords}</p>}
          <span className={css.footPair}>
            <button type="button" className={btnSm} onClick={() => start(lead.id, "clarify")}>{L("Ask a question", "Tanya soalan")}</button>
            <button type="button" className={btnSmDanger} onClick={() => start(lead.id, "reject")}>{L("Reject", "Tolak")}</button>
          </span>
        </div>
      ) : evLead ? (
        <div className={css.footActs} data-testid="payment-decide">
          <button type="button" className={css.btnVerify} onClick={() => start(evLead.id, "evidence")}><AppIcon name="verify" />{L("Check bank evidence", "Semak bukti bank")}</button>
        </div>
      ) : undefined}>
      {!pic ? <SkelRows rows={4} /> : (
        <div className={css.stack}>
          <span className={css.flags}>
            <SettlementChip s={settlementOf(pic.invoice.total_cents, pic.verified_cents, pic.invoice.payment_status === "paid", pic.invoice.payment_status === "void")} testId="drawer-settlement" />
            {waiting && <ReviewChip r={reviewOf(waiting)} testId="drawer-review" />}
          </span>
          <AmountSummary total={pic.invoice.total_cents} verified={pic.verified_cents} pending={pic.pending_cents} paid={pic.invoice.payment_status === "paid"} />
          {reportable && (
            <div className={css.more}>
              {left > 0
                ? <button type="button" className={btnSm} onClick={() => onReport(openRow!)}>{pic.verified_cents > 0 || pic.pending_cents > 0 ? L("Report remaining payment", "Lapor baki bayaran") : L("Report payment", "Lapor bayaran")}</button>
                : <button type="button" className={btnSmQuiet} data-testid="report-additional" onClick={() => onReport(openRow!)}>{L("Report an additional payment", "Lapor bayaran tambahan")}</button>}
            </div>
          )}
          {pic.reports.length === 0 && <p className={css.empty}>{L("No payment reported yet.", "Belum ada bayaran dilapor.")}</p>}
          {pic.reports.map((r) => {
            const pending = ["reported", "evidence_checked"].includes(r.state);
            const canVerify = data.can.verify && pending;
            const verifiedEv = pic.events.find((e) => e.report_id === r.id && e.event === "verified");
            const canEvidence = data.can.evidence && r.state === "reported" && r.reported_by !== userId && r.needs_evidence;
            const rv = reviewOf(r);
            return (
              <article key={r.id} className={css.pay} data-testid="payment-item">
                <div className={css.bar}>
                  <span className={css.title}><AppIcon name="pay" />{L("Reported payment", "Bayaran dilapor")} · {fmtRM(r.amount_cents)}</span>
                  <ReviewChip r={rv} />
                </div>
                <dl className={css.facts}>
                  <div><dt>{L("Submitted by", "Dihantar oleh")}</dt><dd>{whoWord(r)} · {dmyMYT(r.reported_at)}</dd></div>
                  <div><dt>{L("Received on", "Diterima pada")}</dt><dd>{dmy(r.received_on)}</dd></div>
                  <div><dt>{L("Method", "Kaedah")}</dt><dd>{methodWord(r.method)}</dd></div>
                  {r.reference && <div><dt>{L("Bank reference", "Rujukan bank")}</dt><dd>{r.reference}</dd></div>}
                  <div><dt>{L("Issuing company", "Syarikat pengeluar")}</dt><dd>{pic.invoice.company_name}</dd></div>
                  <div><dt>{L("Told to pay into", "Diminta bayar ke")}</dt><dd>{letterhead(pic.invoice.company)}</dd></div>
                  {r.bank_name && <div><dt>{L("Received in", "Diterima dalam")}</dt><dd>{r.bank_name}</dd></div>}
                </dl>
                {r.note && <p className={`${css.sub} ${css.lines}`}>{r.note}</p>}
                {r.has_proof ? <ReceiptPreview reportId={r.id} /> : r.mine && data.can.verify
                  ? <p className={css.sub}>{L("No proof attached - optional for your own payment.", "Tiada bukti dilampirkan - pilihan untuk bayaran anda sendiri.")}</p>
                  : r.state === "verified" ? <p className={css.sub}>{L("No proof attached.", "Tiada bukti dilampirkan.")}</p>
                  : <p className="erp-note erp-note-warning">{L("No proof attached yet - it cannot be verified without one.", "Tiada bukti dilampirkan - ia tidak boleh disahkan tanpanya.")}</p>}
                {canVerify && r.mine && <p className="erp-note" data-testid="own-sale-banner"><b>{saleBanner(pic.invoice.salesperson_id, pic.invoice.salesperson, userId)}</b></p>}
                {rv === "awaiting_independent" && (
                  <div className={css.evid} data-testid="evidence-waiting">
                    <AppIcon name="verify" />
                    <div><b>{L("Independent evidence review - waiting for the COO", "Semakan bukti bebas - menunggu COO")}</b>
                      <p>{r.mine
                        ? L("You reported this payment, so the COO checks the money in the company's bank first (authenticator code and a note). Your Verify unlocks after that.", "Anda melaporkan bayaran ini, jadi COO menyemak wang dalam bank syarikat dahulu (kod pengesah dan catatan). Sahkan anda dibuka selepas itu.")
                        : L("The CEO reported this payment: another person checks the bank evidence before the CEO can verify it.", "CEO melaporkan bayaran ini: orang lain menyemak bukti bank sebelum CEO boleh mengesahkannya.")}</p></div>
                  </div>
                )}
                {r.evidence_name && <p className={css.sub}>{L("Bank evidence checked by", "Bukti bank disemak oleh")} {r.evidence_name}{r.evidence_at ? ` · ${dmyMYT(r.evidence_at)}` : ""}{r.evidence_note ? `: ${r.evidence_note}` : ""}</p>}
                {r.dup_of !== null && <p className="erp-note erp-note-danger">{L("Possible duplicate: this reference was already used in this company.", "Mungkin pendua: rujukan ini telah digunakan dalam syarikat ini.")}{r.dup_reason ? ` ${L("Verified because:", "Disahkan kerana:")} ${r.dup_reason}` : ""}</p>}
                {r.over_cents > 0 && <p className="erp-note erp-note-warning">{L(`Reported ${fmtRM(r.over_cents)} above the balance. At most the balance is verified; the rest is never applied to another invoice.`, `Dilapor ${fmtRM(r.over_cents)} melebihi baki. Paling banyak baki disahkan; selebihnya tidak digunakan untuk invois lain.`)}</p>}
                {r.question && <p className="erp-note">{L("CEO's question:", "Soalan CEO:")} {r.question}{r.answer ? ` - ${L("Answer:", "Jawapan:")} ${r.answer}` : ""}</p>}
                {r.state === "verified" && saleWords(verifiedEv) && <p className={css.sub} data-testid="sale-words"><b>{r.mine ? L("Marked paid by you", "Ditanda dibayar oleh anda") : L("Verified", "Disahkan")} · {saleWords(verifiedEv)}</b></p>}
                {r.state === "verified" && <p className={css.sub}>{L("Verified", "Disahkan")} {fmtRM(r.verified_cents ?? 0)} {L("by", "oleh")} {r.decided_name ?? "-"} · {r.bank_name ?? ""} · {r.verify_method === "receipt_only" ? L("checked on the receipt only", "disemak pada resit sahaja") : r.verify_method === "bank_app" ? L("checked in the bank app", "disemak dalam aplikasi bank") : L("checked on the bank statement", "disemak pada penyata bank")}</p>}
                {r.reason && <p className="erp-note erp-note-danger">{L("Reason:", "Sebab:")} {r.reason}</p>}
                {r.reverse_reason && <p className="erp-note erp-note-warning">{L("Reversed:", "Dibatalkan:")} {r.reverse_reason}</p>}
                <div className={css.actions}>
                  {r.mine && ["reported", "clarify"].includes(r.state) && <button type="button" className={btnSm} onClick={() => start(r.id, "proof")}>{r.has_proof ? L("Replace proof", "Ganti bukti") : L("Attach proof", "Lampir bukti")}</button>}
                  {r.mine && r.state === "clarify" && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "answer")}>{L("Answer", "Jawab")}</button>}
                  {canEvidence && r.id !== evLead?.id && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "evidence")}>{L("Check bank evidence", "Semak bukti bank")}</button>}
                  {/* the first payment that waits carries its decision in the sheet's foot */}
                  {canVerify && r.id !== lead?.id && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "verify", r)}>{L("Verify payment", "Sahkan bayaran")}</button>}
                  {data.can.verify && pending && r.id !== lead?.id && <button type="button" className={btnSm} onClick={() => start(r.id, "clarify")}>{L("Ask a question", "Tanya soalan")}</button>}
                  {data.can.verify && (pending || r.state === "clarify") && r.id !== lead?.id && <button type="button" className={btnSmDanger} onClick={() => start(r.id, "reject")}>{L("Reject", "Tolak")}</button>}
                  {data.can.verify && r.state === "verified" && <button type="button" className={btnSmDanger} onClick={() => start(r.id, "reverse")}>{L("Reverse", "Batalkan")}</button>}
                </div>
                {act?.rid === r.id && (
                  <div className={css.formCol} data-testid="payment-action" ref={formRef}>
                    {act.mode === "verify" && (<>
                      <label className={css.field}>{L("Received in account", "Diterima dalam akaun")}
                        <select className={selectClassSm} value={bank} onChange={(e) => setBank(e.target.value ? Number(e.target.value) : "")}>
                          <option value="">{L("Choose the account", "Pilih akaun")}</option>
                          {data.banks.map((b) => <option key={b.id} value={b.id} disabled={b.company !== pic.invoice.company}>{b.name} {b.number_masked} {b.company ? `(${COMPANY[b.company] ?? b.company})` : L("(no company yet)", "(tiada syarikat lagi)")}</option>)}
                        </select>
                      </label>
                      <label className={css.field}>{L("How you checked it", "Cara anda menyemak")}
                        <select className={selectClassSm} value={vm} onChange={(e) => setVm(e.target.value)}>
                          <option value="bank_statement">{L("Bank statement", "Penyata bank")}</option>
                          <option value="bank_app">{L("Bank app / online banking", "Aplikasi bank / perbankan dalam talian")}</option>
                        </select>
                      </label>
                      <p className={css.sub}>{L("A receipt alone does not prove the money settled: check the money in the bank.", "Resit sahaja tidak membuktikan wang telah masuk: semak wang dalam bank.")}</p>
                      <label className={css.field}>{L("Amount verified (RM)", "Amaun disahkan (RM)")}<input className={inputClassSm} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
                      {r.dup_of !== null && <label className={css.field}>{L("Why this is a different payment", "Mengapa ini bayaran berlainan")}<input className={inputClassSm} value={dup} maxLength={300} onChange={(e) => setDup(e.target.value)} /></label>}
                    </>)}
                    {act.mode === "evidence" && (<>
                      <label className={css.check}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {L("I saw this money in the company's bank account", "Saya melihat wang ini dalam akaun bank syarikat")}</label>
                      <label className={css.field}>{L("How you checked", "Cara anda menyemak")}<input className={inputClassSm} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></label>
                    </>)}
                    {["reject", "reverse", "clarify", "answer"].includes(act.mode) && (
                      <label className={css.field}>{act.mode === "clarify" ? L("Your question", "Soalan anda") : act.mode === "answer" ? L("Your answer", "Jawapan anda") : L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)")}
                        <textarea className={textareaClass} rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
                      </label>
                    )}
                    {act.mode === "proof" && <label className={css.field}>{L("Proof - PDF, JPEG or PNG", "Bukti - PDF, JPEG atau PNG")}<input className={inputClassSm} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
                    {needsCode && <label className={css.field}>{L("Authenticator code", "Kod pengesah")}<input className={inputClassSm} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>}
                    <div className={css.actions}>
                      <button type="button" className={act.mode === "reject" || act.mode === "reverse" ? btnSmDanger : btnSmPrimary} disabled={!ready} onClick={() => void run()}>
                        {busy ? L("Saving…", "Menyimpan…") : act.mode === "verify" ? L("Verify payment", "Sahkan bayaran") : act.mode === "reject" ? L("Reject payment", "Tolak bayaran") : act.mode === "reverse" ? L("Reverse payment", "Batalkan bayaran") : act.mode === "evidence" ? L("Confirm evidence", "Sahkan bukti") : act.mode === "proof" ? L("Attach", "Lampir") : L("Send", "Hantar")}
                      </button>
                      <button type="button" className={btnSmQuiet} onClick={() => setAct(null)}>{L("Cancel", "Batal")}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          <section aria-label={L("Payment timeline", "Garis masa bayaran")}>
            <h4 className={css.h}>{L("Timeline", "Garis masa")}</h4>
            {timeline.length ? <StageTimeline stages={timeline} label={L("Payment timeline", "Garis masa bayaran")} testId="payment-timeline" /> : <p className={css.empty}>{L("Nothing has happened yet.", "Belum ada apa-apa.")}</p>}
          </section>
        </div>
      )}
    </SideDrawer>
  );
}
