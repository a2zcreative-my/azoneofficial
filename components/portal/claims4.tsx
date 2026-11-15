"use client";

/* v1.310.0 - CLAIMS WORKSPACE 4.0 (the CEO, 15-11-2026: "approve as
   recommended", C-0 ... C-13 in claude/CLAIMS-WORKSPACE-4.0-BLUEPRINT.md;
   references 1 Overview, 2 Submit Claim, 3 My Claims).

   The pieces of the five views that are new in 4.0. They draw; they decide
   nothing. Every rule shown here is the server's own:
     Submit Claim   three steps (Claim Details -> Attachments -> Review &
                    Submit) beside My Claim Info and Required Documents: the
                    company mileage rate, the salary advance rule, the
                    receipt rule (C-8) and "approved is not paid" (C-5)
     My Claims      your own claims and the claims paid to you, never anyone
                    else's (C-4), each a card with its stages from the
                    server's timeline (GET /staff/claims, claim-chain.ts),
                    left to right
   The Overview and the Reports are claims-overview.tsx; the decisions stay
   in the panel (role-panels.tsx ClaimsPanel), one handler each. */

import type { ReactNode } from "react";

import { claimStages, claimStatusChip, type ClaimLike } from "@/components/portal/claim-detail";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { properName } from "@/lib/names";
import { card, chipSmInfo, chipSmNeutral, chipSmSuccess } from "@/lib/ui-styles";
import css from "./claims4.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type ClaimsView4 = "overview" | "submit" | "mine" | "approvals" | "reports";
export const CLAIMS_VIEWS: readonly ClaimsView4[] = ["overview", "submit", "mine", "approvals", "reports"];
export const isClaimsView = (v: string | null): v is ClaimsView4 => !!v && (CLAIMS_VIEWS as readonly string[]).includes(v);

type Line = { claim_date: string; category: string; description?: string; amount_cents: number; km?: number };

/** C-8, the server's own rule: a reimbursement needs its receipt; a claim
    whose every line is mileage, and a salary advance, need none. */
export const needsReceipt = (type: string | undefined, lines: readonly { km?: number | string }[]) =>
  type !== "salary_advance" && !(lines.length > 0 && lines.every((l) => Number(l.km) > 0));

/* ---------- Submit Claim ---------- */
export type ClaimStep4 = 1 | 2 | 3;
const STEP_NAMES = (): [ClaimStep4, string][] => [[1, L("Claim Details", "Butiran Tuntutan")], [2, L("Attachments", "Lampiran")], [3, L("Review & Submit", "Semak & Hantar")]];

export function ClaimSteps({ step }: { step: ClaimStep4 }) {
  return (
    <ol className={css.stepper} aria-label={L("Steps", "Langkah")} data-testid="claim-steps">
      {STEP_NAMES().map(([n, name]) => (
        <li key={n} data-state={n < step ? "done" : n === step ? "now" : "todo"} aria-current={n === step ? "step" : undefined}>
          <span className={css.stepNum}>{n < step ? <AppIcon name="success" /> : n}</span>
          <span>{name}</span>
        </li>
      ))}
    </ol>
  );
}

/** The right-hand panel of reference 2: the rules in force, read from the
    settings the server holds - nothing invented. */
export function ClaimSubmitAside({ advance, rateCents, mileageOnly, recoverMonthLabel }: {
  advance: boolean;
  rateCents: number;
  mileageOnly: boolean;
  recoverMonthLabel: string;
}) {
  return (
    <aside className={css.aside} aria-label={L("Claim information", "Maklumat tuntutan")}>
      <section className={card} data-testid="claim-info">
        <p className={css.asideTitle}><AppIcon name="info" />{L("My Claim Info", "Maklumat Tuntutan Saya")}</p>
        <ul className={css.facts}>
          {advance ? (
            <>
              <li><span>{L("Salary advance", "Pendahuluan gaji")}</span><strong>{L("One amount, one reason", "Satu amaun, satu sebab")}</strong></li>
              <li><span>{L("Recovered from", "Dipotong daripada")}</span><strong>{recoverMonthLabel}</strong></li>
              <li><span>{L("Deducted by", "Dipotong oleh")}</span><strong>{L("Payroll, after it is paid out", "Gaji, selepas dibayar")}</strong></li>
            </>
          ) : (
            <>
              <li><span>{L("Mileage rate", "Kadar perbatuan")}</span><strong>RM {(rateCents / 100).toFixed(2)}/km</strong></li>
              <li><span>{L("Mileage distance", "Jarak perbatuan")}</span><strong>{L("Round trip, per Google Maps", "Pergi balik, ikut Google Maps")}</strong></li>
              <li><span>{L("Amount", "Amaun")}</span><strong>{L("Counted again by the server", "Dikira semula oleh pelayan")}</strong></li>
            </>
          )}
          <li><span>{L("Approval", "Kelulusan")}</span><strong>{L("The chain for your role; never yourself", "Rantaian peranan anda; bukan diri sendiri")}</strong></li>
          <li><span>{L("Payment", "Bayaran")}</span><strong>{L("Approved is not paid: Paid shows the bank date", "Diluluskan bukan dibayar: Dibayar menunjukkan tarikh bank")}</strong></li>
        </ul>
      </section>
      <section className={card} data-testid="claim-documents-required">
        <p className={css.asideTitle}><AppIcon name="attach" />{L("Required Documents", "Dokumen Diperlukan")}</p>
        <ul className={css.docs}>
          {advance ? (
            <li data-need="none"><AppIcon name="success" /><span><strong>{L("No receipt", "Tiada resit")}</strong><em>{L("The signed request authorises the payroll deduction.", "Permohonan bertandatangan membenarkan potongan gaji.")}</em></span></li>
          ) : mileageOnly ? (
            <li data-need="none"><AppIcon name="success" /><span><strong>{L("No receipt for mileage", "Tiada resit untuk perbatuan")}</strong><em>{L("Every line is km at the company rate.", "Setiap baris ialah km pada kadar syarikat.")}</em></span></li>
          ) : (
            <li data-need="required"><AppIcon name="receipt" /><span><strong>{L("Receipt - required", "Resit - wajib")}</strong><em>{L("A photo or PDF, up to 8 MB. Without it the claim cannot be approved.", "Foto atau PDF, sehingga 8 MB. Tanpanya tuntutan tidak boleh diluluskan.")}</em></span></li>
          )}
          <li data-need="info"><AppIcon name="print" /><span><strong>{L("Printed claim form", "Borang tuntutan bercetak")}</strong><em>{L("From the claim once submitted, for signatures in ink.", "Daripada tuntutan selepas dihantar, untuk tandatangan dakwat.")}</em></span></li>
        </ul>
      </section>
    </aside>
  );
}

/** Step 3: what will be sent, in the words of the printed form. */
export function ClaimReview({ advance, purpose, lines, total, receiptName, hasReceipt, payee, recoverMonthLabel, catOf, editingNo }: {
  advance: boolean;
  purpose: string;
  lines: readonly Line[];
  total: number;
  receiptName: string | null;
  hasReceipt: boolean;
  payee: string | null;
  recoverMonthLabel: string;
  catOf: (k: string) => string;
  editingNo: string | null;
}) {
  const need = needsReceipt(advance ? "salary_advance" : "reimbursement", lines);
  return (
    <div className={css.review} data-testid="claim-review">
      <dl className={css.reviewGrid}>
        <div><dt>{L("Type", "Jenis")}</dt><dd>{advance ? L("Salary advance", "Pendahuluan gaji") : L("Reimbursement", "Bayaran balik")}{editingNo ? ` · ${editingNo}` : ""}</dd></div>
        <div><dt>{advance ? L("Reason", "Sebab") : L("Purpose", "Tujuan")}</dt><dd>{purpose.trim() || "—"}</dd></div>
        {payee && <div><dt>{advance ? L("Advance for", "Pendahuluan untuk") : L("Pay to", "Bayar kepada")}</dt><dd>{payee}</dd></div>}
        {advance && <div><dt>{L("Recovered from", "Dipotong daripada")}</dt><dd>{recoverMonthLabel}</dd></div>}
        {!advance && <div><dt>{L("Receipt", "Resit")}</dt><dd>{receiptName ?? (hasReceipt ? L("Already attached", "Sudah dilampirkan") : need ? L("Missing", "Tiada") : L("Not needed (mileage)", "Tidak perlu (perbatuan)"))}</dd></div>}
      </dl>
      {!advance && (
        <ul className={css.reviewLines}>
          {lines.map((it, i) => (
            <li key={i}>
              <span className={css.reviewLine}><strong className={css.cap}>{catOf(it.category)}</strong><span>{dmy(it.claim_date)}{it.description ? ` · ${it.description}` : ""}{it.km ? ` · ${it.km} km` : ""}</span></span>
              <span className={css.num}>{fmtRM(it.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={css.reviewTotal}><span>{L("Total", "Jumlah")}</span><strong>{fmtRM(total)}</strong></p>
    </div>
  );
}

/* ---------- My Claims ---------- */
export type MineClaim = ClaimLike & {
  id: number; user_id: number; claim_date: string; category: string; amount_cents: number; description?: string | null;
  claim_type?: string; payee_user_id?: number | null; claimant?: string | null; claimant_full?: string | null; receipt_key?: string | null;
};

/** One claim's stages, left to right: the server's timeline in words. */
export function ClaimTrack({ c }: { c: ClaimLike }) {
  const stages = claimStages(c);
  if (stages.length === 0) return null;
  return (
    <ol className={css.track} aria-label={L(`Progress: ${claimStatusChip(c).text}`, `Kemajuan: ${claimStatusChip(c).text}`)} data-testid="claim-track">
      {stages.map((s) => (
        <li key={s.key} data-state={s.state}>
          <span className={css.trackDot} aria-hidden>{s.state === "done" ? <AppIcon name="success" /> : s.state === "rejected" ? <AppIcon name="error" /> : null}</span>
          <span className={css.trackText}><strong>{s.title}</strong>{s.aside && <em>{s.aside}</em>}</span>
        </li>
      ))}
    </ol>
  );
}

export function MyClaims4({ list, loaded, userId, noOf, catOf, itemsOf, actions, toolbar }: {
  /** already filtered by the panel to this person's own claims and those paid to them */
  list: readonly MineClaim[];
  loaded: boolean;
  userId: number;
  noOf: (c: MineClaim) => string;
  catOf: (k: string) => string;
  itemsOf: (c: MineClaim) => Line[];
  /** the card's buttons: View, Attach receipt, Edit, Delete - the panel's own */
  actions: (c: MineClaim) => ReactNode;
  toolbar: ReactNode;
}) {
  return (
    <section className={card} aria-label={L("My claims", "Tuntutan saya")} id="claims-list">
      <div className={css.mineHead}>
        <div>
          <p className="erp-heading">{L("My Claims", "Tuntutan Saya")}</p>
          <p className="erp-meta">{L("Your own claims, and the claims raised for you and paid to you. Nobody else's.", "Tuntutan anda sendiri, dan tuntutan yang dibuat untuk anda dan dibayar kepada anda. Bukan milik orang lain.")}</p>
        </div>
        {toolbar}
      </div>
      <ul className={css.cards} data-testid="my-claims">
        {!loaded && <li><SkelRows rows={3} /></li>}
        {loaded && list.length === 0 && <li className={css.empty}>{L("No claims to show.", "Tiada tuntutan untuk ditunjukkan.")}</li>}
        {list.map((c) => {
          const its = itemsOf(c);
          const st = claimStatusChip(c);
          const forMe = c.user_id !== userId && c.payee_user_id === userId;
          return (
            <li key={c.id} className={css.claimCard} data-record={`claim:${c.id}`}>
              <div className={css.cardTop}>
                <span className={css.cardId}>
                  <strong className={css.mono}>{noOf(c)}</strong>
                  <span className="erp-meta">{dmy(c.claim_date)} · {c.claim_type === "salary_advance" ? L("Salary advance", "Pendahuluan gaji") : its.length > 1 ? L(`${its.length} items`, `${its.length} item`) : <span className={css.cap}>{catOf(c.category)}</span>}</span>
                </span>
                <span className={css.cardAmt}>{fmtRM(c.amount_cents)}</span>
              </div>
              <div className={css.cardChips}>
                <span className={st.cls} data-testid="claim-waiting">{st.text}</span>
                {forMe && <span className={chipSmSuccess}>{L(`Raised for you by ${properName(c.claimant_full || c.claimant || "")}`, `Dibuat untuk anda oleh ${properName(c.claimant_full || c.claimant || "")}`)}</span>}
                {c.claim_type !== "salary_advance" && c.status !== "approved" && !c.receipt_key && needsReceipt(c.claim_type, its) && <span className={chipSmInfo}>{L("Receipt missing", "Resit tiada")}</span>}
                {c.return_open && c.user_id === userId && <span className={chipSmNeutral}>{L("Question waiting for you", "Soalan menunggu anda")}</span>}
              </div>
              {c.description && <p className={css.cardDesc}>{c.description}</p>}
              <ClaimTrack c={c} />
              <div className={css.cardActions}>{actions(c)}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
