import type { Metadata } from "next";

import { ContactForm } from "@azone/forms";
import { Button, ButtonGroup, PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { BRAND, whatsappUrl } from "@/constants/brand";
import { CMS_SITE } from "@/constants/seo";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Ask ELFIA about a piece, a drop, or an order — WhatsApp is fastest, or send us a message.",
};

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Contact"
        title="Talk to us"
        intro="WhatsApp is the fastest way to reach us — ask about a piece, a drop, or an order and we will reply personally."
      >
        <section>
          <ButtonGroup>
            <Button href={whatsappUrl()} external>
              Message us on WhatsApp
            </Button>
            <Button href={`mailto:${BRAND.email}`} external variant="outline">
              {BRAND.email}
            </Button>
          </ButtonGroup>
        </section>

        <div className="grid gap-12 lg:grid-cols-2">
          <section>
            <h2>Send a message</h2>
            <p className="mt-3 mb-6">
              Prefer writing it down? Tell us what you are after and we will
              come back to you by email or WhatsApp.
            </p>
            <ContactForm site={CMS_SITE} whatsappHref={whatsappUrl()} />
          </section>

          <section>
            <h2>Follow the drops</h2>
            <p className="mt-3">
              Pieces launch during live sessions and sell out in-session.
              Following is the only reliable way to catch one.
            </p>
            <ul className="mt-6 space-y-3">
              <li>
                <a
                  href={BRAND.socials.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  TikTok — @elfia.official
                </a>
              </li>
              <li>
                <a
                  href={BRAND.socials.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  Instagram — @elfia.official
                </a>
              </li>
            </ul>
          </section>
        </div>
      </PageShell>
      <Footer />
    </>
  );
}
