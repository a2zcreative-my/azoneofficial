import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { FaqList } from "@/components/ui/faq-list";
import { PackagesCarousel } from "@/components/ui/packages-carousel";
import { PACKAGES, PACKAGE_MATRIX, whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "Packages",
  description:
    "Live commerce packages from AZ ONE OFFICIAL — Starter, Growth, Scale, and Enterprise. Hours, live hosts, reporting, creative, and consultation for Malaysian brands selling on TikTok Live.",
};

function Cell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <span className="text-gold-deep" aria-label="Included">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-muted-foreground/50" aria-label="Not included">
        —
      </span>
    );
  }
  return <span>{value}</span>;
}

export default function PackagesPage() {
  return (
    <PageShell
      eyebrow="Packages"
      title="Pick the level of support you need"
      intro="Every engagement starts with a free live audit — we look at your products and your current channel, then recommend a tier. Pricing is quoted per brand, so you only pay for the cadence and creative you actually use."
    >
      {/* Cards — the primary view, and the only one on mobile */}
      <section>
        <PackagesCarousel packages={PACKAGES} />
      </section>

      {/* Comparison — desktop only; the cards above already say this on mobile */}
      <section className="hidden lg:block">
        <h2>Compare side by side</h2>
        <div className="border-border mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Feature comparison across AZ ONE OFFICIAL live commerce packages
            </caption>
            <thead>
              <tr className="bg-secondary/60">
                <th scope="col" className="p-4 font-semibold">
                  Feature
                </th>
                {PACKAGES.map((tier) => (
                  <th key={tier.name} scope="col" className="p-4 font-semibold">
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PACKAGE_MATRIX.map((row) => (
                <tr key={row.feature} className="border-t border-border">
                  <th scope="row" className="p-4 font-medium">
                    {row.feature}
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={`${row.feature}-${PACKAGES[i]?.name ?? i}`}
                      className="text-muted-foreground p-4"
                    >
                      <Cell value={value} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>What it costs</h2>
        <p className="mt-3 mb-6">
          We quote per brand rather than publish a rate card, because the right
          number depends on cadence, hosts, and creative volume. These are the
          questions we get asked most before that conversation.
        </p>
        <FaqList limit={6} offset={5} />
      </section>

      <section>
        <h2>Not sure which tier fits?</h2>
        <p className="mt-3 mb-6">
          That is what the free live audit is for. Send us your products and
          we&apos;ll tell you honestly whether live is worth it for you — and
          which tier we&apos;d start you on.
        </p>
        <ButtonGroup>
          <Button href={whatsappUrl()} external>
            Get a free live audit
          </Button>
          <Button href="/contact" variant="outline">
            Book a strategy call
          </Button>
        </ButtonGroup>
      </section>
    </PageShell>
  );
}
