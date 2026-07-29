import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ElfiaGallery } from "@/components/ui/elfia-gallery";
import { CONTACT, ELFIA, ELFIA_PRODUCTS, whatsappUrl } from "@/constants/content";
import { CASE_STUDIES } from "@/constants/pages";

export const metadata: Metadata = {
  title: "ELFIA — case study",
  description:
    "How AZ ONE OFFICIAL built and runs the live selling channel for ELFIA, a premium hijab label — challenge, approach, and result.",
};

/**
 * Featured client case study.
 *
 * Built entirely from existing design-system pieces — PageShell, Button,
 * ButtonGroup, ElfiaGallery — so it reads as part of the same site rather
 * than a bolt-on. Content comes from CASE_STUDIES, the same source the
 * /case-studies page uses, so the two can never drift.
 */
export default function ElfiaCaseStudyPage() {
  const study = CASE_STUDIES.find((cs) => cs.client === "ELFIA");

  return (
    <PageShell
      eyebrow="Featured client"
      title={study?.title ?? "ELFIA"}
      intro="A premium hijab label that needed a live channel from a standing start — and a way to sell fabric that only convinces when you see it move."
    >
      <section>
        <h2>The brand</h2>
        <p className="mt-3">{ELFIA.body}</p>
        <p className="text-gold-deep mt-4 text-sm tracking-[0.14em] italic">
          {ELFIA.slogan} — {ELFIA.tagline}
        </p>
      </section>

      {study && (
        <>
          <section>
            <h2>Challenge</h2>
            <p className="mt-3">{study.challenge}</p>
          </section>

          <section>
            <h2>Approach</h2>
            <p className="mt-3">{study.approach}</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {[
                "Live commerce strategy",
                "Live hosts",
                "Live operations",
                "Creative content",
              ].map((service) => (
                <li
                  key={service}
                  className="bg-secondary text-muted-foreground rounded-md px-3 py-1.5 text-xs"
                >
                  {service}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Result</h2>
            <p className="mt-3">{study.result}</p>
          </section>
        </>
      )}

      <section>
        <h2>The work</h2>
        <p className="mt-3 mb-8">
          Pieces styled and sold on camera. Each drop is priced live to limited
          quantities, so the session is the release event.
        </p>
        <div className="bg-brand rounded-xl px-6 py-10">
          <ElfiaGallery products={ELFIA_PRODUCTS} />
        </div>
        <p className="text-muted-foreground mt-8 text-sm">
          ELFIA sells through its own store and live sessions —{" "}
          <a
            href="https://elfia.com.my"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground font-medium underline"
          >
            visit elfia.com.my
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Want a channel like this?</h2>
        <p className="mt-3 mb-6">
          Every engagement starts with a free live audit — we review your
          products and current channel, then tell you honestly whether live is
          worth it for you.
        </p>
        <ButtonGroup>
          <Button href={whatsappUrl()} external>
            Get a free live audit
          </Button>
          <Button href={CONTACT.socials.tiktok} external variant="outline">
            Watch ELFIA live
          </Button>
        </ButtonGroup>
      </section>
    </PageShell>
  );
}
