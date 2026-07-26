import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { SERVICES, whatsappUrl } from "@/constants/content";

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
        <h2>How we package this</h2>
        <p className="mt-3 mb-6">
          These services are bundled into four tiers — Starter, Growth, Scale,
          and Enterprise — so you can start at the cadence that fits and move up
          when live starts pulling its weight. Pricing is quoted per brand.
        </p>
        <ButtonGroup>
          <Button href="/packages">Compare packages</Button>
          <Button href={whatsappUrl()} external variant="outline">
            Get a free live audit
          </Button>
        </ButtonGroup>
      </section>

    </PageShell>
  );
}
