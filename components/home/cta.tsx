/* v1.195.0 - THE FINAL CALL TO ACTION: the navy band the owner's mockup
   ends on. The free live audit on WhatsApp, a strategy call through the
   contact page, and the direct lines (WhatsApp, email) from CONTACT - the
   same numbers the rest of the site uses. The heading keeps its Admin ->
   Content key (home.cta.heading). */

import { ArrowRight, Mail, MessageCircle, MapPin } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
import { Reveal } from "@/components/ui/reveal";
import { CONTACT, whatsappUrl } from "@/constants/content";
import { CTA_LABEL, SITE_CONFIG } from "@/constants/site";

import css from "./home.module.css";

const phone = `+${CONTACT.whatsapp.slice(0, 2)} ${CONTACT.whatsapp.slice(2, 4)}-${CONTACT.whatsapp.slice(4, 7)} ${CONTACT.whatsapp.slice(7)}`;

export function Cta() {
  return (
    <section id="contact" className={css.section}>
      <div className={css.wrap}>
        <Reveal className={css.ctaBand}>
          <div className={css.ctaGrid}>
            <div>
              <p className={css.heroEyebrow}>Ready when you are</p>
              <h2 className={css.ctaTitle}>
                <Editable k="home.cta.heading" fallback="Your next customer is already watching someone sell. Make it you." />
              </h2>
              <p className={css.ctaText}>Start with a free live audit: we review your products, your brand, and your current channels — then tell you honestly where the growth is and whether live is part of it. No commitment, no pressure.</p>
            </div>
            <div className={css.ctaSide}>
              <a className={css.btnGold} href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
                <span>{CTA_LABEL}</span><ArrowRight aria-hidden="true" />
              </a>
              <Link className={css.btnGhost} href="/contact"><span>Book a strategy call</span></Link>
              <ul className={css.ctaContacts}>
                <li><a href={whatsappUrl()} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" /><span data-no-translate>WhatsApp {phone}</span></a></li>
                <li><a href={`mailto:${CONTACT.email}`}><Mail aria-hidden="true" /><span data-no-translate>{CONTACT.email}</span></a></li>
                <li><Link href="/contact"><MapPin aria-hidden="true" /><span data-no-translate>{SITE_CONFIG.address}</span></Link></li>
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
