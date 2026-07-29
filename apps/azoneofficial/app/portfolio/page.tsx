import Link from "next/link";
import type { Metadata } from "next";

import { Button, ButtonGroup, PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { CASE_STUDIES, whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Live commerce work by AZ ONE OFFICIAL — client results, case studies, and success stories from TikTok Live and Shopee Live channels we run for Malaysian brands.",
};

export default function PortfolioPage() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Portfolio"
        title="Client results, in their own words"
        intro="Every engagement below started the same way: a brand with product and no live channel. These are the channels we built and what changed as a result."
      >
        <section>
          <ul className="grid gap-6 lg:grid-cols-2">
            {CASE_STUDIES.map((study) => (
              <li key={study.slug}>
                <Link
                  href={`/portfolio/${study.slug}`}
                  className="border-border hover:border-foreground/40 group flex h-full flex-col rounded-xl border p-6 transition-colors"
                >
                  <p className="text-gold-deep text-xs font-semibold tracking-[0.28em] uppercase">
                    {study.industry}
                  </p>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight group-hover:underline">
                    {study.client}
                  </h2>
                  <p className="text-muted-foreground mt-3 grow text-sm leading-relaxed">
                    {study.summary}
                  </p>
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {study.services.map((service) => (
                      <li
                        key={service}
                        className="bg-secondary text-muted-foreground rounded-md px-2.5 py-1 text-xs"
                      >
                        {service}
                      </li>
                    ))}
                  </ul>
                  <span className="text-foreground mt-5 text-sm font-medium">
                    Read the case study →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Could this be your channel?</h2>
          <p className="mt-3 mb-6">
            Start with a free live audit — we review your products and current
            channel, then tell you honestly whether live is worth it for you.
          </p>
          <ButtonGroup>
            <Button href={whatsappUrl()} external>
              Get a free live audit
            </Button>
            <Button href="/packages" variant="outline">
              See packages
            </Button>
          </ButtonGroup>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
