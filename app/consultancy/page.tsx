import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { whatsappUrl } from "@/constants/content";
import { CONSULTANCY } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Consultancy",
  description: CONSULTANCY.metaDescription,
  alternates: { canonical: "/consultancy" },
};

/**
 * /consultancy (v1.27.0) — AZ ONE OFFICIAL, the consultancy business unit of
 * A2Z Creative Marketing.
 *
 * Built from the same pieces as every other marketing page (PageShell,
 * Button, ButtonGroup) with no bespoke styling, so it inherits the site's
 * rhythm. All copy lives in CONSULTANCY in constants/pages.ts — house rule:
 * content in constants, never hard-coded here.
 */
export default function ConsultancyPage() {
  return (
    <PageShell
      eyebrow={CONSULTANCY.eyebrow}
      title={CONSULTANCY.title}
      intro={CONSULTANCY.intro}
    >
      <section>
        <p className="text-gold-deep text-xs font-medium tracking-[0.2em] uppercase">
          {CONSULTANCY.lockup}
        </p>
        {/* Direct <p> children of <section> so PageShell's max-w-3xl
            measure rule applies and running text stays readable. */}
        {CONSULTANCY.positioning.map((paragraph) => (
          <p key={paragraph} className="mt-5">
            {paragraph}
          </p>
        ))}
      </section>

      <section>
        <h2>{CONSULTANCY.servicesTitle}</h2>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {CONSULTANCY.services.map(({ title, description }) => (
            <article
              key={title}
              className="rounded-xl border border-border p-5"
            >
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>{CONSULTANCY.credibilityTitle}</h2>
        {CONSULTANCY.credibility.map((paragraph) => (
          <p key={paragraph} className="mt-5">
            {paragraph}
          </p>
        ))}
      </section>

      <section>
        <h2>{CONSULTANCY.engagementTitle}</h2>
        <ol className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {CONSULTANCY.engagement.map((item, i) => (
            <li
              key={item}
              className="h-full rounded-xl border border-border p-5"
            >
              <span className="text-gold-deep text-sm font-semibold tracking-[0.2em]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="mt-2 text-sm leading-relaxed">{item}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>{CONSULTANCY.ctaTitle}</h2>
        <p className="mt-3 mb-6">{CONSULTANCY.ctaBody}</p>
        <ButtonGroup>
          <Button href={whatsappUrl()} external>
            Book a free consultation
          </Button>
          <Button href="/services" variant="outline">
            See all services
          </Button>
        </ButtonGroup>
      </section>
    </PageShell>
  );
}
