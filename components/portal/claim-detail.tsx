"use client";

/* v1.254.0 - THE CLAIM DRAWER (the owner, 02-11-2026: "Claims Approval &
   Payment Timeline"; claude/CLAIMS-TIMELINE-AUDIT.md, D1-D3).

   Progress, Details, Documents, Comments, Activity - the same parts as the
   Leave drawer, drawn with the same components: the shared StageTimeline
   (Leave, Payroll), SideDrawer (full screen on a phone, actions pinned
   above the bottom bar), and the shared comment thread and activity list
   (record-thread.tsx). It decides nothing: every step, who the claim waits
   on and every button come from GET /claims (worker/src/claim-chain.ts);
   the actions are the Claims panel's own (the same endpoints and dialogs
   the rows use). Approval is not payment - the payment step turns green
   only when Mark paid recorded it. */

import { useState } from "react";
import { L } from "@/components/portal/page-shared";
import { RecordActivity, RecordComments } from "@/components/portal/record-thread";
import { SideDrawer } from "@/components/ui/side-drawer";
import { LineTabs } from "@/components/ui/line-tabs";
import { DetailGrid } from "@/components/ui/record-row";
import { StageDots, StageTimeline, type Stage, type StageState } from "@/components/ui/stage-timeline";
import { AppIcon } from "@/components/ui/app-icon";
import { dmy, dmyMYT, fmtRM } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnClass, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass } from "@/lib/ui-styles";
import { rowBtn, rowBtnDanger, rowBtnPrimary } from "@/components/ui/row-button";
import lv from "./leave-page.module.css";

export type ClaimStepKey = "submitted" | "hr" | "pre" | "final" | "payment";
export interface ClaimStep {
  key: ClaimStepKey;
  state: StageState;
  who: string | null;
  at: string | null;
  text: string | null;
  flags?: Record<string, string | boolean>;
}
export type ClaimWaiter = "hr" | "coo" | "cco" | "ceo" | "applicant" | "payment" | null;
export type ClaimActionKey = "review" | "preapprove" | "approve" | "reject" | "return" | "resubmit" | "pay";

/** The fields the drawer reads (the panel's Claim row satisfies it). */
export interface ClaimLike {
  id: number;
  user_id: number;
  status: string;
  amount_cents: number;
  claim_date: string;
  category: string;
  description?: string | null;
  receipt_key?: string | null;
  payment_proof_key?: string | null;
  claimant?: string | null;
  claimant_full?: string | null;
  claimant_role?: string | null;
  claimant_position?: string | null;
  claimant_department?: string | null;
  payee_user_id?: number | null;
  payee_name?: string | null;
  payee_full?: string | null;
  claim_type?: string | null;
  payroll_month?: string | null;
  paid_at?: string | null;
  created_at: string;
  timeline?: ClaimStep[];
  waiting_on?: ClaimWaiter;
  my_turn?: boolean;
  actions?: ClaimActionKey[];
  skip_if_approved?: ("hr" | "pre")[];
  return_open?: boolean;
  return_question?: string | null;
  paid_bank_date?: string | null;
  paid_by_name?: string | null;
}

const ROLE_NAME: Record<string, string> = { hr_admin: "HR", coo: "COO", cco: "CCO", ceo: "CEO" };
const roleWord = (r: string | boolean | undefined) => ROLE_NAME[String(r ?? "")] ?? "";

/** Whom the claim waits on, in words, and the chip it wears. */
export function claimStatusChip(c: ClaimLike): { text: string; cls: string } {
  if (c.status === "rejected") return { text: L("Rejected", "Ditolak"), cls: chipSmDanger };
  if (c.status === "approved") return c.paid_at
    ? { text: L("Paid", "Dibayar"), cls: chipSmSuccess }
    : { text: L("Payment due", "Bayaran perlu dibuat"), cls: chipSmWarn };
  const w = c.waiting_on;
  if (w === "applicant") return { text: L("Waiting on the claimant", "Menunggu penuntut"), cls: chipSmWarn };
  if (w === "hr") return { text: L("Waiting on HR", "Menunggu HR"), cls: chipSmInfo };
  if (w === "coo") return { text: L("Waiting on COO", "Menunggu COO"), cls: chipSmInfo };
  if (w === "cco") return { text: L("Waiting on CCO", "Menunggu CCO"), cls: chipSmInfo };
  if (w === "ceo") return { text: L("Waiting on CEO", "Menunggu CEO"), cls: chipSmInfo };
  return { text: L("Pending", "Menunggu"), cls: chipSmNeutral };
}

/** "Approve" when the chain is done; "Approve (skip CCO pre-approval)"
    when approving now would pass a stage - the CEO's recorded override,
    said before the click. */
export function approveLabel(c: ClaimLike): string {
  const skip = c.skip_if_approved ?? [];
  if (skip.length === 0) return L("Approve", "Luluskan");
  const names = skip.map((k) => k === "hr" ? L("HR review", "semakan HR") : (c.claimant_role === "hr_admin" ? L("CCO pre-approval", "pra-kelulusan CCO") : L("COO pre-approval", "pra-kelulusan COO")));
  return L(`Approve (skip ${names.join(" and ")})`, `Luluskan (langkau ${names.join(" dan ")})`);
}

/** The shared timeline's stages for one claim, in words. */
export function claimStages(c: ClaimLike): Stage[] {
  const steps = c.timeline ?? [];
  return steps.map((s): Stage => {
    const role = roleWord(s.flags?.role);
    const when = s.at ? dmyMYT(s.at) : null;
    const by = s.who ? properName(s.who) : null;
    if (s.key === "submitted") return { key: s.key, state: s.state, title: L("Claim submitted", "Tuntutan dihantar"),
      sub: by ? L(`by ${by}`, `oleh ${by}`) : undefined, aside: when ?? undefined };
    if (s.key === "payment") {
      const bank = typeof s.flags?.bank_date === "string" ? dmy(s.flags.bank_date) : null;
      const adv = typeof s.flags?.payroll_month === "string" ? s.flags.payroll_month : null;
      if (s.state === "done") return { key: s.key, state: s.state, title: L("Payment confirmed", "Bayaran disahkan"),
        sub: [by ? L(`recorded by ${by}`, `direkod oleh ${by}`) : null, bank ? L(`bank date ${bank}`, `tarikh bank ${bank}`) : null,
          s.flags?.proof ? L("payout proof attached", "bukti bayaran dilampirkan") : null].filter(Boolean).join(" · ") || undefined,
        note: adv ? L(`Recovered on the ${adv} payslip`, `Dipotong pada slip gaji ${adv}`) : undefined, aside: when ?? undefined };
      if (s.state === "rejected") return { key: s.key, state: s.state, title: L("Payment reversed", "Bayaran dibatalkan"),
        sub: typeof s.flags?.reversed_on === "string" ? L(`Reversed in Finance on ${dmy(s.flags.reversed_on)}`, `Dibatalkan di Kewangan pada ${dmy(s.flags.reversed_on)}`) : undefined, aside: when ?? undefined };
      if (s.state === "now") return { key: s.key, state: s.state, title: L("Payment due", "Bayaran perlu dibuat"),
        sub: L("Approved - the reimbursement has not been paid yet", "Diluluskan - bayaran balik belum dibuat"), aside: L("Awaiting payment", "Menunggu bayaran") };
      return { key: s.key, state: s.state, title: L("Payment", "Bayaran"),
        sub: s.state === "off" ? L("Not paid - the claim was rejected", "Tidak dibayar - tuntutan ditolak") : L("After approval: the reimbursement is paid and recorded", "Selepas kelulusan: bayaran balik dibuat dan direkod") };
    }
    const title = s.key === "hr" ? L("HR review", "Semakan HR")
      : s.key === "pre" ? L(`Pre-approval - ${role}`, `Pra-kelulusan - ${role}`)
        : L("Approval - CEO", "Kelulusan - CEO");
    if (s.state === "done") return { key: s.key, state: s.state, title,
      sub: by ? L(`by ${by}`, `oleh ${by}`) : undefined, aside: when ?? undefined,
      note: s.text ?? undefined, warn: s.flags?.override ? L("Approved before the chain was complete - recorded as a CEO override", "Diluluskan sebelum rantaian lengkap - direkod sebagai pintasan CEO") : undefined };
    if (s.state === "skipped") return { key: s.key, state: s.state, title,
      sub: s.flags?.waived ? L("Not needed - passed to the CEO", "Tidak perlu - diserahkan kepada CEO") : L("Skipped - the CEO approved directly (recorded)", "Dilangkau - CEO meluluskan terus (direkod)") };
    if (s.state === "rejected") return { key: s.key, state: s.state, title: L("Rejected", "Ditolak"),
      sub: by ? L(`by ${by}`, `oleh ${by}`) : undefined, note: s.text ?? undefined, aside: when ?? undefined };
    if (s.state === "returned") return { key: s.key, state: s.state, title,
      sub: by ? L(`returned for more information by ${by}`, `dikembalikan untuk maklumat oleh ${by}`) : L("Returned for more information", "Dikembalikan untuk maklumat"),
      note: s.text ?? undefined, aside: L("Waiting on the claimant", "Menunggu penuntut") };
    if (s.state === "now") return { key: s.key, state: s.state, title,
      sub: s.flags?.answered ? L(`Answered - back with ${role}`, `Dijawab - kembali kepada ${role}`) : L(`Waiting on ${role}`, `Menunggu ${role}`), aside: L("Currently waiting", "Sedang menunggu") };
    return { key: s.key, state: s.state, title, sub: s.state === "off" ? L("Not reached", "Tidak sampai") : L(`${role} decides`, `${role} membuat keputusan`) };
  });
}

/** The compact line for a row or a card. */
export function ClaimDots({ c }: { c: ClaimLike }) {
  const steps = c.timeline ?? [];
  if (steps.length === 0) return null;
  return <StageDots states={steps.map((s) => s.state)} label={L(`Progress: ${claimStatusChip(c).text}`, `Kemajuan: ${claimStatusChip(c).text}`)} />;
}

const CLAIM_ACTIVITY: Record<string, [string, string]> = {
  "claim.create": ["Submitted", "Dihantar"], "claim.edit": ["Edited by the claimant", "Disunting oleh penuntut"],
  "claim.resubmit": ["Resubmitted", "Dihantar semula"], "claim.hr_review": ["HR reviewed", "Disemak HR"],
  "claim.preapprove": ["Pre-approved", "Pra-diluluskan"], "claim.approve": ["Approved", "Diluluskan"],
  "claim.reject": ["Rejected", "Ditolak"], "claim.return": ["Returned for more information", "Dikembalikan untuk maklumat"],
  "claim.answer": ["Answered and resubmitted", "Dijawab dan dihantar semula"], "claim.paid": ["Payment confirmed", "Bayaran disahkan"],
  "claim.payment_proof": ["Payout proof attached", "Bukti bayaran dilampirkan"], "claim.payee_set": ["Payee set", "Penerima bayaran ditetapkan"],
  "claim.comment": ["Comment added", "Komen ditambah"],
};

type Tab = "progress" | "details" | "documents" | "comments" | "activity";

export function ClaimDrawer({ c, userId, number, category, items, onClose, onAct, onResubmit, onOpenReceipt, onOpenProof }: {
  c: ClaimLike | null;
  userId: number;
  number: (c: ClaimLike) => string;
  category: (cat: string) => string;
  items: (c: ClaimLike) => { claim_date: string | null; category: string; description?: string | null; amount_cents: number; km?: number | null }[];
  onClose: () => void;
  /** the panel's own handlers: the same endpoints and dialogs as the rows */
  onAct: (c: ClaimLike, a: ClaimActionKey) => void;
  onResubmit: (c: ClaimLike, answer: string) => Promise<boolean>;
  onOpenReceipt: (c: ClaimLike) => void;
  onOpenProof: (c: ClaimLike) => void;
}) {
  const [tab, setTab] = useState<Tab>("progress");
  const [answer, setAnswer] = useState("");
  const [shownId, setShownId] = useState<number | null>(null);
  if (c && c.id !== shownId) { setShownId(c.id); setTab("progress"); setAnswer(""); }
  const own = !!c && (c.user_id === userId || (c.payee_user_id != null && c.payee_user_id === userId));
  const acts = c?.actions ?? [];
  const chipNow = c ? claimStatusChip(c) : null;
  const who = c ? properName(c.claimant_full || c.claimant || "") : "";
  return (
    <SideDrawer open={c !== null} onClose={onClose} wide full
      title={c ? `${L("Claim details", "Butiran tuntutan")} - ${number(c)}` : ""}
      subtitle={c ? `${who}${c.claimant_position ? ` · ${c.claimant_position}` : ""} · ${fmtRM(c.amount_cents)}` : undefined}
      footer={c && acts.some((a) => a !== "resubmit") ? (
        <span className={lv.drawerActions} data-testid="claim-actions">
          {acts.includes("review") && <button type="button" className={rowBtnPrimary} onClick={() => onAct(c, "review")}>{L("HR review OK", "Semakan HR OK")}</button>}
          {acts.includes("preapprove") && <button type="button" className={rowBtnPrimary} onClick={() => onAct(c, "preapprove")}>{L("Pre-approve", "Pra-lulus")}</button>}
          {acts.includes("approve") && <button type="button" className={acts.includes("review") || acts.includes("preapprove") ? rowBtn : rowBtnPrimary} onClick={() => onAct(c, "approve")}>{approveLabel(c)}</button>}
          {acts.includes("return") && <button type="button" className={rowBtn} onClick={() => onAct(c, "return")}>{L("Return for info", "Kembalikan untuk maklumat")}</button>}
          {acts.includes("reject") && <button type="button" className={rowBtnDanger} onClick={() => onAct(c, "reject")}>{L("Reject", "Tolak")}</button>}
          {acts.includes("pay") && <button type="button" className={rowBtnPrimary} onClick={() => onAct(c, "pay")}><AppIcon name="paid" />{L("Mark paid", "Tanda dibayar")}</button>}
        </span>
      ) : undefined}>
      {c && (
        <div className={lv.drawerBody} data-testid="claim-drawer">
          <p className={lv.sub}>{chipNow && <span className={chipNow.cls} data-testid="claim-status">{chipNow.text}</span>}</p>
          <LineTabs value={tab} onChange={(k) => setTab(k as Tab)} label={L("Claim", "Tuntutan")} tabs={[
            ["progress", L("Progress", "Kemajuan")], ["details", L("Details", "Butiran")], ["documents", L("Documents", "Dokumen")],
            ["comments", L("Comments", "Komen")], ["activity", L("Activity", "Aktiviti")],
          ] as readonly (readonly [Tab, string])[]} />
          {tab === "progress" && c.user_id === userId && c.return_open && acts.includes("resubmit") && (
            <section className={lv.returnBox} data-testid="claim-resubmit" aria-label={L("Returned for more information", "Dikembalikan untuk maklumat")}>
              <p className={lv.dTitle}>{L("Returned for more information", "Dikembalikan untuk maklumat")}</p>
              {c.return_question && <p className={lv.threadBody}>{c.return_question}</p>}
              <label className={lv.threadForm}><span className={lv.sub}>{L("Your answer", "Jawapan anda")}</span>
                <textarea className={inputClass} rows={2} maxLength={500} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
              <p className={lv.sub}>{L("To change the amount or the items, use Edit on the claim instead - an edit starts the approvals again.", "Untuk menukar amaun atau item, gunakan Sunting pada tuntutan - suntingan memulakan kelulusan semula.")}</p>
              <div><button type="button" className={btnClass} disabled={answer.trim().length < 3}
                onClick={async () => { if (await onResubmit(c, answer.trim())) setAnswer(""); }}><AppIcon name="verify" />{L("Answer & resubmit", "Jawab & hantar semula")}</button></div>
            </section>
          )}
          {tab === "progress" && (
            <section className={lv.dSection} aria-label={L("Claim approval timeline", "Garis masa kelulusan tuntutan")}>
              <p className={lv.dTitle}>{L("Claim approval timeline", "Garis masa kelulusan tuntutan")}</p>
              <p className={lv.sub}>{L("Where this claim stands, who decided each step and when. Approval and payment are separate steps.", "Kedudukan tuntutan ini, siapa memutuskan setiap langkah dan bila. Kelulusan dan bayaran ialah langkah berasingan.")}</p>
              <StageTimeline stages={claimStages(c)} label={L("Claim approval timeline", "Garis masa kelulusan tuntutan")} testId="claim-timeline" />
            </section>
          )}
          {tab === "details" && (
            <section className={lv.dSection} aria-label={L("Claim summary", "Ringkasan tuntutan")}>
              <p className={lv.dTitle}>{L("Claim summary", "Ringkasan tuntutan")}</p>
              <DetailGrid items={[
                { label: L("Claim no.", "No. tuntutan"), value: number(c) },
                { label: L("Claimant", "Penuntut"), value: who },
                { label: L("Type", "Jenis"), value: c.claim_type === "salary_advance" ? L("Salary advance", "Pendahuluan gaji") : L("Reimbursement", "Bayaran balik") },
                { label: L("Category", "Kategori"), value: category(c.category) },
                { label: L("Amount", "Amaun"), value: fmtRM(c.amount_cents) },
                { label: L("Claim date", "Tarikh tuntutan"), value: dmy(c.claim_date) },
                { label: L("Submitted", "Dihantar"), value: dmyMYT(c.created_at) },
                { label: L("Status", "Status"), value: chipNow?.text ?? "" },
                { label: L("Paid on", "Dibayar pada"), value: c.paid_at ? dmyMYT(c.paid_at) : L("Not paid", "Belum dibayar") },
                { label: L("Bank date", "Tarikh bank"), value: c.paid_bank_date ? dmy(c.paid_bank_date) : null },
                { label: L("Pay to", "Bayar kepada"), value: c.payee_full || c.payee_name ? properName(c.payee_full || c.payee_name || "") : null },
                { label: L("Purpose", "Tujuan"), value: c.description ?? null, wide: true },
              ]} />
              <ul className={lv.thread} aria-label={L("Items", "Item")}>
                {items(c).map((it, i) => (
                  <li key={i}><span className={lv.threadHead}><strong>{category(it.category)}{it.km ? ` · ${it.km} km` : ""}</strong><span>{it.claim_date ? dmy(it.claim_date) : ""}</span></span>
                    <span className={lv.threadBody}>{it.description || "—"} · {fmtRM(it.amount_cents)}</span></li>
                ))}
              </ul>
            </section>
          )}
          {tab === "documents" && (
            <section className={lv.dSection} aria-label={L("Supporting documents", "Dokumen sokongan")} data-testid="claim-documents">
              <p className={lv.dTitle}>{L("Supporting documents", "Dokumen sokongan")}</p>
              {c.receipt_key ? <button type="button" className={rowBtn} onClick={() => onOpenReceipt(c)}><AppIcon name="attach" />{L("View receipt", "Lihat resit")}</button>
                : <p className={lv.sub}>{c.claim_type === "salary_advance" ? L("A salary advance has no receipt.", "Pendahuluan gaji tiada resit.") : L("No receipt attached.", "Tiada resit dilampirkan.")}</p>}
              {c.payment_proof_key ? <button type="button" className={rowBtn} onClick={() => onOpenProof(c)}><AppIcon name="paid" />{L("View payout proof", "Lihat bukti bayaran")}</button>
                : c.paid_at ? <p className={lv.sub}>{L("No payout proof attached yet.", "Tiada bukti bayaran dilampirkan lagi.")}</p> : null}
            </section>
          )}
          {tab === "comments" && <RecordComments base={`/staff/claims/${c.id}`} own={own} testId="claim-comments" radioName={`claim-${c.id}`}
            ownPrompt={L("Write to the approvers", "Tulis kepada pelulus")} />}
          {tab === "activity" && <RecordActivity base={`/staff/claims/${c.id}`} labels={CLAIM_ACTIVITY} testId="claim-activity"
            empty={L("Nothing recorded for this claim yet (older records kept no trail).", "Tiada rekod untuk tuntutan ini lagi (rekod lama tiada jejak).")} />}
        </div>
      )}
    </SideDrawer>
  );
}
