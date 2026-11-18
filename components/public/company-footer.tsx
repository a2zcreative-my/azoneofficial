/* v1.381.0 - WHO IS BEHIND THIS FORM (the CEO, 18-11-2026: "make them trust of this system").
   The public forms (/apply/partner, /apply/business) end with the registered company: its name,
   SSM number, office address, the official WhatsApp and email, the privacy notice, and one plain
   anti-scam line. Every fact is read from its one source - lib/issuers.ts (A2Z's letterhead) and
   constants/content.ts (CONTACT) - so this footer can never drift from the documents. */
import Link from "next/link";
import { A2Z_CREATIVE } from "@/lib/issuers";
import { CONTACT } from "@/constants/content";
import css from "./company-footer.module.css";

export function CompanyFooter({ lang }: { lang: "en" | "ms" }) {
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const wa = `https://wa.me/${CONTACT.whatsapp}`;
  return (
    <footer className={css.foot} data-testid="company-footer">
      <div className={css.inner}>
        <p className={css.who}>
          <strong>{A2Z_CREATIVE.name}</strong>
          <span>{A2Z_CREATIVE.registration}</span>
        </p>
        <p className={css.line}>{A2Z_CREATIVE.address}</p>
        <p className={css.line}>
          <a href={wa} target="_blank" rel="noopener" className={css.link}>WhatsApp {A2Z_CREATIVE.whatsapp}</a>
          <span aria-hidden="true"> · </span>
          <a href={`mailto:${CONTACT.email}`} className={css.link}>{CONTACT.email}</a>
          <span aria-hidden="true"> · </span>
          <Link href="/privacy" className={css.link}>{L("Privacy Notice", "Notis Privasi")}</Link>
        </p>
        <p className={css.safe}>
          {L("This form belongs to A2Z Creative Marketing at a2zcreative.my. We never ask for a password, a bank PIN, a TAC code or any payment on this form. If in doubt, WhatsApp us on the number above.",
             "Borang ini milik A2Z Creative Marketing di a2zcreative.my. Kami tidak pernah meminta kata laluan, PIN bank, kod TAC atau sebarang bayaran pada borang ini. Jika ragu-ragu, WhatsApp kami di nombor di atas.")}
        </p>
      </div>
    </footer>
  );
}
