"use client";

/* v1.272.0 - SALES -> PAYMENTS (the CEO, 10-11-2026: "COO, CCO and
   authorized sales staff can report payments. They must not self-finalize
   paid status. Every payment requires CEO verification.";
   claude/PAYMENT-VERIFICATION-AUDIT.md, answers P1-P9 as recommended).

   One tab: what is waiting, the open invoices with what is verified, pending
   and outstanding, the Record Payment sheet (amount, day, method, reference,
   the proof) and one drawer per invoice with its payments, the proof, the
   actions this person may take and the timeline. Every rule is the server's
   (worker/src/payment-verify.ts); this screen only offers what it allows. */

import { useEffect, useMemo, useState } from "react";
import { api, csrfFetch } from "@/lib/api";
import { compressImage } from "@/lib/compress-image";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmDanger, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SideDrawer } from "@/components/ui/side-drawer";
import { StageTimeline, type Stage } from "@/components/ui/stage-timeline";
import { openAttachment } from "@/components/ui/document-preview";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import css from "./payments-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Caps { report: boolean; verify: boolean; evidence: boolean; switch: boolean; all: boolean }
interface Bank { id: number; name: string; bank: string; number_masked: string; company: string | null }
interface Rep {
  id: number; invoice_id: number; issuer_code: string; amount_cents: number; received_on: string; method: string; reference: string | null;
  over_cents: number; dup_of: number | null; state: string; reported_by: number; reported_at: string; evidence_by: number | null;
  decided_at: string | null; verified_cents: number | null; question: string | null; has_proof: boolean; mine: boolean; needs_evidence: boolean;
  doc_number?: string; customer?: string | null; reporter?: string | null; salesperson?: string | null;
  note?: string | null; answer?: string | null; reason?: string | null; evidence_note?: string | null; evidence_name?: string | null;
  decided_name?: string | null; bank_name?: string | null; verify_method?: string | null; dup_reason?: string | null; reverse_reason?: string | null;
}
interface OpenInv {
  id: number; doc_number: string; total_cents: number; customer: string | null; salesperson: string | null; company: string;
  verified_cents: number; pending_cents: number; outstanding_cents: number; status: string; can_report: boolean;
}
interface Data {
  on: boolean; ready: boolean; can: Caps; banks: Bank[]; reports: Rep[]; invoices: OpenInv[];
  tiles: { pending_cents: number; pending_count: number; verified_month_cents: number; outstanding_cents: number; outstanding_invoices: number; partial_invoices: number };
}
interface Ev { id: number; report_id: number | null; event: string; amount_cents: number | null; detail: string | null; created_at: string; actor: string | null }
interface Picture {
  invoice: { id: number; doc_number: string; customer: string | null; total_cents: number; payment_status: string | null; company: string; company_name: string };
  verified_cents: number; pending_cents: number; outstanding_cents: number; status: string; reports: Rep[]; events: Ev[]; can_report: boolean;
}
type Err = { error?: { message?: string; code?: string } };

const COMPANY: Record<string, string> = { a2z: "A2Z", azoo: "AZ ONE" };
const STATE_WORDS: Record<string, [string, string, string]> = {
  reported: ["Awaiting CEO verification", "Menunggu pengesahan CEO", chipSmWarn],
  evidence_checked: ["Evidence checked - awaiting CEO", "Bukti disemak - menunggu CEO", chipSmInfo],
  clarify: ["Clarification required", "Penjelasan diperlukan", chipSmWarn],
  verified: ["Verified by CEO", "Disahkan CEO", chipSmSuccess],
  rejected: ["Rejected", "Ditolak", chipSmDanger],
  reversed: ["Reversed", "Dibatalkan", chipSmNeutral],
};
const STATUS_WORDS: Record<string, [string, string, string]> = {
  unpaid: ["Unpaid", "Belum dibayar", chipSmNeutral],
  reported: ["Reported - awaiting CEO", "Dilapor - menunggu CEO", chipSmWarn],
  partial: ["Partially paid", "Dibayar separa", chipSmInfo],
  fully_reported: ["Fully reported - awaiting CEO", "Dilapor penuh - menunggu CEO", chipSmWarn],
  paid: ["Paid - CEO verified", "Dibayar - disahkan CEO", chipSmSuccess],
};
const EVENT_WORDS: Record<string, [string, string]> = {
  reported: ["Payment reported", "Bayaran dilapor"], proof_uploaded: ["Proof uploaded", "Bukti dimuat naik"],
  evidence_checked: ["Bank evidence checked", "Bukti bank disemak"], clarification_requested: ["Clarification requested", "Penjelasan diminta"],
  clarification_answered: ["Clarification answered", "Penjelasan dijawab"], verified: ["CEO verified payment", "CEO mengesahkan bayaran"],
  rejected: ["CEO rejected payment", "CEO menolak bayaran"], outstanding_updated: ["Outstanding updated", "Baki dikemas kini"],
  invoice_paid: ["Invoice paid - all payments verified", "Invois dibayar - semua bayaran disahkan"], reversed: ["Payment reversed", "Bayaran dibatalkan"],
};
const METHODS: [string, string, string][] = [["bank_transfer", "Bank transfer", "Pindahan bank"], ["online", "Online / DuitNow", "Dalam talian / DuitNow"], ["cheque", "Cheque", "Cek"], ["cash", "Cash", "Tunai"], ["other", "Other", "Lain-lain"]];
const words = (m: Record<string, [string, string, string]>, k: string) => m[k] ?? [k, k, chipSmNeutral];
const toCents = (s: string) => { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const msg = (r: { data: unknown }, fallback: string) => (r.data as Err | null)?.error?.message ?? fallback;

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

export function PaymentsPanel({ userId, onChanged }: { userId: number; onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<"waiting" | "all" | "verified" | "closed">("waiting");
  const [q, setQ] = useState("");
  const [openInv, setOpenInv] = useState<number | null>(null);
  const [recordFor, setRecordFor] = useState<OpenInv | null>(null);
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

  const shown = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.reports.filter((r) => {
      if (filter === "waiting" && !["reported", "evidence_checked", "clarify"].includes(r.state)) return false;
      if (filter === "verified" && r.state !== "verified") return false;
      if (filter === "closed" && !["rejected", "reversed"].includes(r.state)) return false;
      return !s || `${r.doc_number ?? ""} ${r.customer ?? ""} ${r.reference ?? ""} ${r.reporter ?? ""}`.toLowerCase().includes(s);
    });
  }, [data, filter, q]);

  if (failed) return <div className={card}><p className={css.empty}>{L("Payments could not be loaded.", "Bayaran tidak dapat dimuatkan.")}</p></div>;
  if (!data) return <div className={card}><SkelRows rows={4} /></div>;

  /* what is waiting for THIS person */
  const mineToAct = (r: Rep) =>
    (data.can.verify && ((r.state === "reported" && !r.mine) || r.state === "evidence_checked"))
    || (data.can.evidence && r.state === "reported" && !r.mine && r.needs_evidence)
    || (r.mine && r.state === "clarify");

  return (
    <div className={css.stack}>
      {toastNode}
      <SwitchCard data={data} onDone={(m) => { toast(L("Saved", "Disimpan"), m); reload(); }} onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />

      <KpiRow label={L("Payments", "Bayaran")}>
        <KpiTile icon="pending" tone="gold" label={L("Pending CEO verification", "Menunggu pengesahan CEO")} value={fmtRM(data.tiles.pending_cents)}
          sub={L(`${data.tiles.pending_count} payment${data.tiles.pending_count === 1 ? "" : "s"} reported`, `${data.tiles.pending_count} bayaran dilapor`)} onClick={() => setFilter("waiting")} />
        <KpiTile icon="verify" tone="green" label={L("Verified this month", "Disahkan bulan ini")} value={fmtRM(data.tiles.verified_month_cents)}
          sub={L("CEO-verified payments only", "Bayaran disahkan CEO sahaja")} onClick={() => setFilter("verified")} />
        <KpiTile icon="balance" tone="red" label={L("Verified outstanding", "Baki disahkan")} value={fmtRM(data.tiles.outstanding_cents)}
          sub={L(`${data.tiles.outstanding_invoices} open invoice${data.tiles.outstanding_invoices === 1 ? "" : "s"} · pending not deducted`, `${data.tiles.outstanding_invoices} invois terbuka · belum ditolak bayaran tertunda`)} />
        <KpiTile icon="money" tone="blue" label={L("Partially paid", "Dibayar separa")} value={data.tiles.partial_invoices}
          sub={L("Invoices with some money verified", "Invois dengan sebahagian wang disahkan")} />
      </KpiRow>

      {data.can.report && data.on && (
        <section className={card} aria-label={L("Open invoices", "Invois terbuka")}>
          <h3 className={css.h}>{L("Open invoices", "Invois terbuka")}</h3>
          <p className={css.meta}>{data.can.all ? L("Every unpaid invoice.", "Setiap invois belum dibayar.") : L("Your unpaid invoices.", "Invois anda yang belum dibayar.")}</p>
          {data.invoices.length === 0 ? <p className={css.empty}>{L("No unpaid invoices.", "Tiada invois belum dibayar.")}</p> : (
            <ul className={css.list}>
              {data.invoices.map((i) => {
                const [en, ms, cls] = words(STATUS_WORDS, i.status);
                return (
                  <li key={i.id} className={`${css.row} ${css.invRow}`}>
                    <button type="button" className={css.rowMain} onClick={() => setOpenInv(i.id)}>
                      <span className={css.title}>{i.doc_number} <span className={css.co}>{COMPANY[i.company] ?? i.company}</span></span>
                      <span className={css.sub}>{i.customer ?? "-"}{i.salesperson ? ` · ${i.salesperson}` : ""}</span>
                    </button>
                    <span className={css.figs}>
                      <span><span className={css.k}>{L("Total", "Jumlah")}</span>{fmtRM(i.total_cents)}</span>
                      <span><span className={css.k}>{L("Verified", "Disahkan")}</span>{fmtRM(i.verified_cents)}</span>
                      <span><span className={css.k}>{L("Pending", "Tertunda")}</span>{fmtRM(i.pending_cents)}</span>
                      <span><span className={css.k}>{L("Outstanding", "Baki")}</span><b>{fmtRM(i.outstanding_cents)}</b></span>
                    </span>
                    <span className={`${cls} ${css.chip}`}>{L(en, ms)}</span>
                    {i.can_report && <button type="button" className={btnSmPrimary} onClick={() => setRecordFor(i)}>{L("Record payment", "Rekod bayaran")}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className={card} aria-label={L("Payment records", "Rekod bayaran")}>
        <div className={css.bar}>
          <h3 className={css.h}>{L("Payment records", "Rekod bayaran")}</h3>
          <div className={css.filters}>
            <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search invoice, customer, reference", "Cari invois, pelanggan, rujukan")} aria-label={L("Search payments", "Cari bayaran")} />
            <select className={selectClassSm} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={L("Show", "Tunjuk")}>
              <option value="waiting">{L("Waiting for review", "Menunggu semakan")}</option>
              <option value="verified">{L("Verified", "Disahkan")}</option>
              <option value="closed">{L("Rejected or reversed", "Ditolak atau dibatalkan")}</option>
              <option value="all">{L("All", "Semua")}</option>
            </select>
          </div>
        </div>
        {!data.ready && <p className="erp-note erp-note-warning">{L("Run migration 0181 (PUSH.bat) to start payment verification.", "Jalankan migrasi 0181 (PUSH.bat) untuk memulakan pengesahan bayaran.")}</p>}
        {shown.length === 0 ? <p className={css.empty}>{L("Nothing here.", "Tiada apa-apa.")}</p> : (
          <ul className={css.list}>
            {shown.map((r) => {
              const [en, ms, cls] = words(STATE_WORDS, r.state);
              const act = mineToAct(r);
              return (
                <li key={r.id} className={`${css.row} ${act ? css.act : ""}`} data-testid="payment-row">
                  <button type="button" className={css.rowMain} onClick={() => setOpenInv(r.invoice_id)}>
                    <span className={css.title}>{r.doc_number} <span className={css.co}>{COMPANY[r.issuer_code] ?? r.issuer_code}</span></span>
                    <span className={css.sub}>{r.customer ?? "-"} · {L("by", "oleh")} {r.reporter ?? "-"} · {dmy(r.received_on)}{r.reference ? ` · ${r.reference}` : ""}</span>
                  </button>
                  <span className={css.amount}>{fmtRM(r.amount_cents)}</span>
                  <span className={css.flags}>
                    <span className={`${cls} ${css.chip}`}>{L(en, ms)}</span>
                    {r.dup_of !== null && <span className={chipSmDanger}>{L("Possible duplicate", "Mungkin pendua")}</span>}
                    {r.over_cents > 0 && <span className={chipSmWarn}>{L(`${fmtRM(r.over_cents)} over`, `${fmtRM(r.over_cents)} lebih`)}</span>}
                    {!r.has_proof && <span className={chipSmNeutral}>{L("No proof", "Tiada bukti")}</span>}
                  </span>
                  <button type="button" className={act ? btnSmPrimary : btnSm} onClick={() => setOpenInv(r.invoice_id)}>
                    {act ? (data.can.verify && r.state !== "clarify" ? L("Review", "Semak") : L("Act", "Ambil tindakan")) : L("View", "Lihat")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recordFor && <RecordSheet inv={recordFor} onClose={() => setRecordFor(null)}
        onDone={(m) => { setRecordFor(null); toast(L("Saved", "Disimpan"), m); reload(); }}
        onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />}
      {openInv !== null && <InvoiceDrawer invId={openInv} data={data} userId={userId} onClose={() => setOpenInv(null)}
        onDone={(m) => { toast(L("Saved", "Disimpan"), m); reload(); }}
        onFail={(m) => toast(L("No changes", "Tiada perubahan"), m, "notice")} />}
    </div>
  );
}

/** The owner's switch, and what it means for everyone else. */
function SwitchCard({ data, onDone, onFail }: { data: Data; onDone: (m: string) => void; onFail: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api<Err>("/staff/payments/settings", { method: "PUT", body: JSON.stringify({ on: !data.on, reason: reason.trim(), totp: code }) });
    setBusy(false); setCode("");
    if (!r.ok) { onFail(msg(r, L("Not changed", "Tidak diubah"))); return; }
    setOpen(false); setReason("");
    onDone(!data.on ? L("Payment verification is on", "Pengesahan bayaran dihidupkan") : L("Payment verification is off", "Pengesahan bayaran dimatikan"));
  };
  return (
    <section className={`${card} ${css.switch}`} aria-label={L("Payment verification", "Pengesahan bayaran")}>
      <div className={css.bar}>
        <div>
          <h3 className={css.h}>{L("Payment verification", "Pengesahan bayaran")} <span className={data.on ? chipSmSuccess : chipSmNeutral}>{data.on ? L("On", "Hidup") : L("Off", "Mati")}</span></h3>
          <p className={css.meta}>{data.on
            ? L("Sales, the COO and CCO report payments with proof. Only the CEO's verification makes a payment real money; the invoice becomes paid when verified payments reach its total.", "Jualan, COO dan CCO melaporkan bayaran dengan bukti. Hanya pengesahan CEO menjadikan bayaran wang sebenar; invois dibayar apabila bayaran disahkan mencapai jumlahnya.")
            : L("Off: payments are recorded the existing way (Mark paid, Confirm Paid). Nothing here changes anything until the owner switches it on.", "Mati: bayaran direkod seperti sedia ada (Tanda dibayar, Sahkan Dibayar). Tiada apa berubah sehingga pemilik menghidupkannya.")}</p>
        </div>
        {data.can.switch && !open && <button type="button" className={data.on ? btnSmQuiet : btnSmPrimary} onClick={() => setOpen(true)}>{data.on ? L("Switch off", "Matikan") : L("Switch on", "Hidupkan")}</button>}
      </div>
      {open && (
        <div className={css.form}>
          <label className={css.field}>{L("Reason", "Sebab")}<input className={inputClassSm} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <label className={css.field}>{L("Authenticator code", "Kod pengesah")}<input className={inputClassSm} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
          <button type="button" className={btnSmPrimary} disabled={busy || reason.trim().length < 5 || code.length !== 6} onClick={() => void save()}>{data.on ? L("Switch off", "Matikan") : L("Switch on", "Hidupkan")}</button>
          <button type="button" className={btnSmQuiet} onClick={() => setOpen(false)}>{L("Cancel", "Batal")}</button>
        </div>
      )}
    </section>
  );
}

/** Record Payment: the report and its proof, one sheet. */
function RecordSheet({ inv, onClose, onDone, onFail }: { inv: OpenInv; onClose: () => void; onDone: (m: string) => void; onFail: (m: string) => void }) {
  const left = Math.max(0, inv.outstanding_cents - inv.pending_cents);
  const [amount, setAmount] = useState(left ? (left / 100).toFixed(2) : "");
  const [on, setOn] = useState(mytToday());
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const cents = toCents(amount);
  const send = async () => {
    setBusy(true);
    const r = await api<{ id?: number; over_cents?: number; possible_duplicate?: boolean } & Err>(`/staff/docs/${inv.id}/payment-reports`, {
      method: "POST", body: JSON.stringify({ amount_cents: cents, received_on: on, method, reference: ref.trim(), note: note.trim() || undefined }),
    });
    if (!r.ok || !r.data?.id) { setBusy(false); onFail(msg(r, L("Not reported - try again", "Tidak dilapor - cuba lagi"))); return; }
    const bad = file ? await uploadProof(r.data.id, file) : null;
    setBusy(false);
    if (bad) { onFail(L(`Reported, but the proof failed: ${bad} Open the invoice to attach it again.`, `Dilapor, tetapi bukti gagal: ${bad} Buka invois untuk melampirkannya semula.`)); onDone(L("Payment reported", "Bayaran dilapor")); return; }
    onDone(r.data.possible_duplicate
      ? L("Reported - this reference was used before, the CEO will check it", "Dilapor - rujukan ini pernah digunakan, CEO akan menyemaknya")
      : L("Payment reported - waiting for the CEO's verification", "Bayaran dilapor - menunggu pengesahan CEO"));
  };
  return (
    <SideDrawer open onClose={onClose} full title={L(`Record payment - ${inv.doc_number}`, `Rekod bayaran - ${inv.doc_number}`)}
      subtitle={L(`${inv.customer ?? ""} · outstanding ${fmtRM(inv.outstanding_cents)}${inv.pending_cents ? ` · ${fmtRM(inv.pending_cents)} pending` : ""}`, `${inv.customer ?? ""} · baki ${fmtRM(inv.outstanding_cents)}${inv.pending_cents ? ` · ${fmtRM(inv.pending_cents)} tertunda` : ""}`)}
      footer={<div className={css.foot}>
        <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !cents || !file || (method !== "cash" && ref.trim().length < 3)} onClick={() => void send()}>{busy ? L("Sending…", "Menghantar…") : L("Report payment", "Lapor bayaran")}</button>
      </div>}>
      <div className={css.formCol}>
        <p className="erp-note">{L("This reports the payment to the CEO. It is not counted as received until the CEO verifies it.", "Ini melaporkan bayaran kepada CEO. Ia tidak dikira diterima sehingga CEO mengesahkannya.")}</p>
        <label className={css.field}>{L("Amount received (RM)", "Amaun diterima (RM)")}<input className={inputClassSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        {cents > left && left > 0 && <p className="erp-note erp-note-warning">{L(`More than the ${fmtRM(left)} left - it will be flagged for review.`, `Melebihi baki ${fmtRM(left)} - ia akan ditanda untuk semakan.`)}</p>}
        <label className={css.field}>{L("Received on", "Diterima pada")}<input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} /></label>
        <label className={css.field}>{L("Method", "Kaedah")}<select className={selectClassSm} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
        <label className={css.field}>{method === "cash" ? L("Receipt number (optional)", "Nombor resit (pilihan)") : L("Bank or payment reference", "Rujukan bank atau bayaran")}<input className={inputClassSm} value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} placeholder="MBB241104-8891" /></label>
        <label className={css.field}>{L("Proof (transfer slip, receipt) - PDF, JPEG or PNG", "Bukti (slip pindahan, resit) - PDF, JPEG atau PNG")}<input className={inputClassSm} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className={css.field}>{L("Remarks (optional)", "Catatan (pilihan)")}<textarea className={textareaClass} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </SideDrawer>
  );
}

type Mode = "verify" | "reject" | "clarify" | "evidence" | "reverse" | "answer" | "proof";

/** One invoice: its figures, its payments, the actions this person may take, the timeline. */
function InvoiceDrawer({ invId, data, userId, onClose, onDone, onFail }: { invId: number; data: Data; userId: number; onClose: () => void; onDone: (m: string) => void; onFail: (m: string) => void }) {
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

  const timeline: Stage[] = (pic?.events ?? []).map((e) => {
    const w = EVENT_WORDS[e.event] ?? [e.event, e.event];
    let d: Record<string, unknown> = {};
    try { d = e.detail ? JSON.parse(e.detail) as Record<string, unknown> : {}; } catch { d = {}; }
    const note = (d.reason ?? d.question ?? d.answer ?? d.note) as string | undefined;
    return {
      key: String(e.id), state: e.event === "rejected" ? "rejected" : e.event === "reversed" ? "returned" : "done",
      title: `${L(...w)}${e.amount_cents ? ` · ${fmtRM(e.amount_cents)}` : ""}`,
      sub: `${e.actor ?? L("System", "Sistem")} · ${dmyMYT(e.created_at)}`,
      note: note ? String(note) : undefined,
    };
  });
  const [sen, sms, scls] = words(STATUS_WORDS, pic?.status ?? "unpaid");

  return (
    <SideDrawer open onClose={onClose} wide full title={pic ? pic.invoice.doc_number : L("Payments", "Bayaran")}
      subtitle={pic ? `${pic.invoice.customer ?? ""} · ${pic.invoice.company_name}` : undefined}>
      {!pic ? <SkelRows rows={4} /> : (
        <div className={css.stack}>
          <div className={css.sum}>
            <span><span className={css.k}>{L("Invoice total", "Jumlah invois")}</span>{fmtRM(pic.invoice.total_cents)}</span>
            <span><span className={css.k}>{L("Verified", "Disahkan")}</span>{fmtRM(pic.verified_cents)}</span>
            <span><span className={css.k}>{L("Pending", "Tertunda")}</span>{fmtRM(pic.pending_cents)}</span>
            <span><span className={css.k}>{L("Outstanding", "Baki")}</span><b>{fmtRM(pic.outstanding_cents)}</b></span>
            <span className={`${scls} ${css.chip}`}>{L(sen, sms)}</span>
          </div>
          {pic.reports.length === 0 && <p className={css.empty}>{L("No payment reported yet.", "Belum ada bayaran dilapor.")}</p>}
          {pic.reports.map((r) => {
            const [en, ms, cls] = words(STATE_WORDS, r.state);
            const pending = ["reported", "evidence_checked"].includes(r.state);
            const canVerify = data.can.verify && pending && (r.reported_by !== userId || (r.state === "evidence_checked" && r.evidence_by !== userId));
            const canEvidence = data.can.evidence && r.state === "reported" && r.reported_by !== userId && r.needs_evidence;
            return (
              <article key={r.id} className={css.pay} data-testid="payment-item">
                <div className={css.bar}>
                  <span className={css.title}>{fmtRM(r.amount_cents)} · {dmy(r.received_on)}</span>
                  <span className={`${cls} ${css.chip}`}>{L(en, ms)}</span>
                </div>
                <p className={css.sub}>{(METHODS.find((m) => m[0] === r.method)?.[1]) ?? r.method}{r.reference ? ` · ${r.reference}` : ""} · {L("reported by", "dilapor oleh")} {r.reporter ?? "-"} {dmyMYT(r.reported_at)}</p>
                {r.note && <p className={`${css.sub} ${css.lines}`}>{r.note}</p>}
                {r.dup_of !== null && <p className="erp-note erp-note-danger">{L("Possible duplicate: this reference was already used in this company.", "Mungkin pendua: rujukan ini telah digunakan dalam syarikat ini.")}{r.dup_reason ? ` ${L("Verified because:", "Disahkan kerana:")} ${r.dup_reason}` : ""}</p>}
                {r.over_cents > 0 && <p className="erp-note erp-note-warning">{L(`Reported ${fmtRM(r.over_cents)} above the balance. At most the balance is verified; the rest is never applied to another invoice.`, `Dilapor ${fmtRM(r.over_cents)} melebihi baki. Paling banyak baki disahkan; selebihnya tidak digunakan untuk invois lain.`)}</p>}
                {r.evidence_name && <p className={css.sub}>{L("Bank evidence checked by", "Bukti bank disemak oleh")} {r.evidence_name}{r.evidence_note ? `: ${r.evidence_note}` : ""}</p>}
                {r.question && <p className="erp-note">{L("CEO's question:", "Soalan CEO:")} {r.question}{r.answer ? ` - ${L("Answer:", "Jawapan:")} ${r.answer}` : ""}</p>}
                {r.state === "verified" && <p className={css.sub}>{L("Verified", "Disahkan")} {fmtRM(r.verified_cents ?? 0)} {L("by", "oleh")} {r.decided_name ?? "-"} · {r.bank_name ?? ""} · {r.verify_method === "receipt_only" ? L("checked on the receipt only", "disemak pada resit sahaja") : r.verify_method === "bank_app" ? L("checked in the bank app", "disemak dalam aplikasi bank") : L("checked on the bank statement", "disemak pada penyata bank")}</p>}
                {r.reason && <p className="erp-note erp-note-danger">{L("Reason:", "Sebab:")} {r.reason}</p>}
                {r.reverse_reason && <p className="erp-note erp-note-warning">{L("Reversed:", "Dibatalkan:")} {r.reverse_reason}</p>}
                <div className={css.actions}>
                  {r.has_proof && <button type="button" className={btnSm} onClick={() => openAttachment(`/api/v1/staff/payment-reports/${r.id}/proof`, L("Payment proof", "Bukti bayaran"))}>{L("View proof", "Lihat bukti")}</button>}
                  {r.mine && ["reported", "clarify"].includes(r.state) && <button type="button" className={btnSm} onClick={() => start(r.id, "proof")}>{r.has_proof ? L("Replace proof", "Ganti bukti") : L("Attach proof", "Lampir bukti")}</button>}
                  {r.mine && r.state === "clarify" && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "answer")}>{L("Answer", "Jawab")}</button>}
                  {canEvidence && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "evidence")}>{L("Check bank evidence", "Semak bukti bank")}</button>}
                  {canVerify && <button type="button" className={btnSmPrimary} onClick={() => start(r.id, "verify", r)}>{L("Verify payment", "Sahkan bayaran")}</button>}
                  {data.can.verify && pending && <button type="button" className={btnSm} onClick={() => start(r.id, "clarify")}>{L("Request clarification", "Minta penjelasan")}</button>}
                  {data.can.verify && (pending || r.state === "clarify") && <button type="button" className={btnSmDanger} onClick={() => start(r.id, "reject")}>{L("Reject", "Tolak")}</button>}
                  {data.can.verify && r.state === "verified" && <button type="button" className={btnSmDanger} onClick={() => start(r.id, "reverse")}>{L("Reverse", "Batalkan")}</button>}
                </div>
                {data.can.verify && r.reported_by === userId && r.state === "reported" && (
                  <p className={css.sub}>{L("You reported this payment: the COO checks its bank evidence before you can verify it.", "Anda melaporkan bayaran ini: COO menyemak bukti banknya sebelum anda boleh mengesahkannya.")}</p>
                )}
                {act?.rid === r.id && (
                  <div className={css.formCol} data-testid="payment-action">
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
                          <option value="receipt_only">{L("Receipt only (not seen in the bank)", "Resit sahaja (tidak dilihat dalam bank)")}</option>
                        </select>
                      </label>
                      {vm === "receipt_only" && <p className="erp-note erp-note-warning">{L("A receipt alone does not prove the money settled. This is recorded as checked on the receipt only.", "Resit sahaja tidak membuktikan wang telah masuk. Ini direkod sebagai disemak pada resit sahaja.")}</p>}
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
