import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { PACKAGES, SERVICES, whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Live host service, live commerce management, TikTok strategy, creative design, content creation, and business consultation.",
};

export default function ServicesPage() {
  return (
    <PageShell
      eyebrow="Services"
      title="Everything a brand needs to win live"
      intro="Pick a single service or hand us the whole channel — every engagement starts with a free consultation so we recommend only what your brand actually needs."
    >
      <section className="grid gap-6 sm:grid-cols-2">
        {SERVICES.map(({ title, description, icon: Icon }) => (
          <article
            key={title}
            className="flex items-start gap-4 rounded-xl border border-border p-5"
          >
            <span className="bg-brand text-gold inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
              <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              <p className="mt-1 text-sm">{description}</p>
            </div>
          </article>
        ))}
      </section>

      <section>
        <p>
          Not sure where to start?{" "}
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            Book a free consultation on WhatsApp
          </a>{" "}
          and we'll map it out together.
        </p>
      </section>
      <section>
        <h2>Packages</h2>
        <p className="mt-3 mb-6">
          Pricing is quoted per brand — these are the levels of support we run.
          Every engagement starts with a free live audit.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {PACKAGES.map((tier) => (
            <article
              key={tier.name}
              className={`flex h-full flex-col rounded-xl border p-6 ${
                tier.featured ? "border-gold-deep/40 bg-secondary/40" : "border-border"
              }`}
            >
              <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
              <p className="text-gold-deep mt-1 text-sm font-medium">{tier.cadence}</p>
              <p className="mt-3 text-sm">{tier.tagline}</p>
              <ul className="mt-4 grow space-y-2">
                {tier.features.map((feature) => (
                  <li key={feature} className="text-sm">
                    — {feature}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href={whatsappUrl()} external>
            Get a free live audit
          </Button>
          <Button href="/contact" variant="outline">
            Book a strategy call
          </Button>
        </div>
      </section>

    </PageShell>
  );
}
