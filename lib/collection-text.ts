/* v1.401.0 - THE PAYMENT REMINDER (Sales Command Center Phase 5, decision 4). The words the Outstanding list
   has sent since v1.4.101, now with the VERIFIED balance, shared by Payments -> Collections. It names the
   invoice's own issuer and ITS bank account (v1.28.0): the customer pays the company that invoiced them.
   Building the message records nothing; the person logs the contact afterwards. */
import type { Issuer } from "@/lib/issuers";
import { fmtRM } from "@/lib/format";

/** "MAYBANK · <HOLDER> · A/C <number>" */
export function bankTransferLine(iss: Issuer): string {
  const [bankName, ...account] = iss.bank.split(" ");
  return `${bankName} · ${iss.bankHolder} · A/C ${account.join(" ")}`;
}

export function reminderText(iss: Issuer, docNumber: string, balanceCents: number): string {
  return `Hi! Gentle reminder from ${iss.name} — invoice ${docNumber} (${fmtRM(balanceCents)} outstanding) is still open. Kindly settle by bank transfer to ${bankTransferLine(iss)}, quoting the invoice number. Thank you!`;
}

/** a Malaysian number as wa.me wants it (60...), or null */
export function waNumber(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/[^0-9]/g, "");
  if (d.length < 8) return null;
  return d.startsWith("60") ? d : d.startsWith("0") ? `6${d}` : d;
}
