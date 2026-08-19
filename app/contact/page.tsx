import { Mail, MapPin, MessageCircle } from "lucide-react";
import type { Metadata } from "next";

import { ContactForm } from "@/components/contact/contact-form";
import { Editable } from "@/components/live/editable";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { CONTACT, whatsappUrl } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact A2Z Creative Marketing — book a free consultation on WhatsApp or visit us in Johor Bahru.",
  alternates: { canonical: "/contact" },
};

const MAP_EMBED_SRC = `https://www.google.com/maps?q=${encodeURIComponent(
  SITE_CONFIG.address,
)}&output=embed`;

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Let's talk about your next live"
    >
      <section>
        <p>
          <Editable
            k="contact.intro"
            fallback="The fastest way to reach us is WhatsApp — tell us about your brand and we'll recommend the right starting package. No commitment."
          />
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button href={whatsappUrl()} external>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp +60 12-383 4821
          </Button>
          <Button href={`mailto:${CONTACT.email}`} external variant="outline">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {CONTACT.email}
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <section>
          <h2>Or send a message</h2>
          <p className="mt-3 mb-6">
            Prefer writing it down? Send us the details and we&apos;ll reply by
            email or WhatsApp.
          </p>
          <ContactForm />
        </section>

        <section>
          <h2>Visit us</h2>
          <p className="mt-3 flex items-start gap-2">
            <MapPin className="text-gold-deep mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{SITE_CONFIG.address}</span>
          </p>
          <div className="mt-6 overflow-hidden rounded-xl border border-border">
            <iframe
              src={MAP_EMBED_SRC}
              title="A2Z Creative Marketing office location on Google Maps"
              className="h-80 w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </section>
      </div>

      <section>
        <h2>Follow us</h2>
        <ul className="mt-3 space-y-2">
          <li>
            <a
              href={CONTACT.socials.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              TikTok
            </a>{" "}
            — where we go live
          </li>
          <li>
            <a
              href={CONTACT.socials.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              Instagram
            </a>
          </li>
          <li>
            <a
              href={CONTACT.socials.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              Facebook
            </a>
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
