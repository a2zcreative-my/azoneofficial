/**
 * v1.181.17 - HR LETTERS (ERP roadmap, phase 5).
 *
 * One template set for the letters HR issues: offer, confirmation,
 * probation extension, warning, resignation acceptance and employment
 * verification. A template is filled from the person's record and then
 * EDITED by HR before it is issued - it is a starting draft, not a
 * contract generator. The issued text is kept as printed (hr_letters), so a
 * reprint is the same letter.
 *
 * Printed on the issuer's letterhead with a hand-signature line. No
 * signature image is ever placed on a letter: the signature vault stays for
 * documents that already use it.
 */

import { DOC } from "@/lib/doc-theme";
import { DOCUMENT_ISSUER } from "@/lib/issuers";

export type LetterKind = "offer" | "confirmation" | "extension" | "warning" | "resignation_acceptance" | "employment_verification";

export const LETTER_LABEL: Record<LetterKind, [string, string]> = {
  offer: ["Offer of employment", "Tawaran pekerjaan"],
  confirmation: ["Confirmation of employment", "Pengesahan jawatan"],
  extension: ["Extension of probation", "Lanjutan tempoh percubaan"],
  warning: ["Warning letter", "Surat amaran"],
  resignation_acceptance: ["Acceptance of resignation", "Penerimaan peletakan jawatan"],
  employment_verification: ["Employment verification", "Pengesahan pekerjaan"],
};

export interface LetterPerson {
  name: string; ic_number?: string | null; position?: string | null; department?: string | null;
  joined_on?: string | null; left_on?: string | null; base_salary_cents?: number | null; address?: string | null;
}

const dLong = (iso?: string | null) => {
  if (!iso) return "[date]";
  const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const money = (c?: number | null) => (c ? `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "RM [amount]");

/** The draft subject and text for a kind, filled from the record. */
export function letterDraft(kind: LetterKind, p: LetterPerson, extra: { ends_on?: string | null; next_ends_on?: string | null } = {}): { subject: string; body: string } {
  const co = DOCUMENT_ISSUER.name;
  const role = p.position || "[position]";
  switch (kind) {
    case "offer":
      return {
        subject: `Offer of employment - ${role}`,
        body: `We are pleased to offer you the position of ${role} with ${co}, starting on ${dLong(p.joined_on)}.\n\nYour basic salary will be ${money(p.base_salary_cents)} a month. You will serve a probation period of three (3) months from your start date, after which your employment will be reviewed for confirmation.\n\nYour working hours, leave entitlement and other benefits follow the company's policies as amended from time to time, and the employment contract you will sign.\n\nPlease sign and return a copy of this letter to accept the offer.`,
      };
    case "confirmation":
      return {
        subject: `Confirmation of employment - ${role}`,
        body: `We are pleased to inform you that, following a review of your performance during your probation period, your employment as ${role} is confirmed with effect from ${dLong(extra.ends_on)}.\n\nAll other terms of your employment remain unchanged.\n\nThank you for your contribution, and we look forward to your continued work with ${co}.`,
      };
    case "extension":
      return {
        subject: `Extension of probation - ${role}`,
        body: `Following a review of your performance, your probation period as ${role} is extended until ${dLong(extra.next_ends_on)}.\n\nDuring this period your supervisor will work with you on the areas discussed with you. Your employment will be reviewed again at the end of the extended period.\n\nAll other terms of your employment remain unchanged.`,
      };
    case "warning":
      return {
        subject: "Warning letter",
        body: `This letter is a formal warning concerning [describe the matter, with dates].\n\nThis conduct does not meet the standard expected of your position as ${role}. You are required to [state the improvement expected] with immediate effect.\n\nShould this recur, further disciplinary action may be taken in accordance with company policy.\n\nPlease sign a copy of this letter to acknowledge that you have received it.`,
      };
    case "resignation_acceptance":
      return {
        subject: "Acceptance of resignation",
        body: `We acknowledge receipt of your resignation from the position of ${role}, and accept it. Your last working day will be ${dLong(p.left_on)}.\n\nBefore your last day, please return all company property and complete the handover of your work. Your final pay will be settled in accordance with your employment terms.\n\nWe thank you for your service with ${co} and wish you every success.`,
      };
    case "employment_verification":
      return {
        subject: "Employment verification",
        body: `This is to certify that ${p.name}${p.ic_number ? ` (NRIC ${p.ic_number})` : ""} ${p.left_on ? "was" : "is"} employed by ${co} as ${role}${p.department ? `, ${p.department}` : ""}, from ${dLong(p.joined_on)}${p.left_on ? ` to ${dLong(p.left_on)}` : " to date"}.\n\nThis letter is issued at the request of the employee for whatever purpose it may serve.`,
      };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The printable letter: the issuer's letterhead, the reference, the text. */
export function letterHtml(l: { ref_no: string; issued_on: string; subject: string; body: string; name: string; position?: string | null; ic_number?: string | null; voided?: boolean }, signer: { name: string; position: string }): string {
  const iss = DOCUMENT_ISSUER;
  const paras = l.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(l.ref_no)} - ${esc(l.subject)}</title>
<style>
  @page { size: A4; margin: 18mm 20mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${DOC.navy}; font-size: 11pt; line-height: 1.55; margin: 0; }
  .head { border-bottom: 3px solid ${DOC.gold}; padding-bottom: 8px; margin-bottom: 22px; }
  .name { font-size: 16pt; font-weight: 800; letter-spacing: 0.02em; }
  .meta { font-size: 8.5pt; color: ${DOC.inkSoft}; }
  .ref { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 18px; }
  .to { margin-bottom: 18px; }
  h1 { font-size: 11.5pt; text-decoration: underline; margin: 0 0 14px; }
  p { margin: 0 0 11px; }
  .sign { margin-top: 42px; }
  .line { width: 220px; border-top: 1px solid ${DOC.navy}; margin-top: 46px; padding-top: 4px; }
  .void { color: ${DOC.navy}; font-weight: 700; border: 2px solid ${DOC.navy}; display: inline-block; padding: 2px 8px; margin-bottom: 12px; }
  .foot { margin-top: 36px; font-size: 8pt; color: ${DOC.muted}; border-top: 1px solid ${DOC.line}; padding-top: 6px; }
</style></head><body>
<div class="head"><div class="name">${esc(iss.name)}</div>
<div class="meta">${esc(iss.descriptor)} &middot; ${esc(iss.registration)}<br>${iss.addressLines.map(esc).join("<br>")}<br>${esc(iss.email)} &middot; ${esc(iss.whatsapp)}</div></div>
${l.voided ? `<div class="void">VOIDED</div>` : ""}
<div class="ref"><span>Ref: ${esc(l.ref_no)}</span><span>${esc(l.issued_on.split("-").reverse().join("-"))}</span></div>
<div class="to"><strong>${esc(l.name)}</strong>${l.ic_number ? `<br>NRIC ${esc(l.ic_number)}` : ""}${l.position ? `<br>${esc(l.position)}` : ""}</div>
<h1>${esc(l.subject)}</h1>
${paras}
<div class="sign">Yours sincerely,<div class="line">${esc(signer.name)}<br>${esc(signer.position)}<br>${esc(iss.name)}</div></div>
<div class="foot">${esc(iss.name)} &middot; ${esc(iss.website)} &middot; This letter is signed by hand.</div>
</body></html>`;
}
