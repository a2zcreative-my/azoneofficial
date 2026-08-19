import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { LivePortfolio } from "@/components/live/live-content";
import { CONTACT, whatsappUrl } from "@/constants/content";
import { PORTFOLIO_ITEMS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Brands, campaigns, and live sessions produced by A2Z Creative Marketing.",
  alternates: { canonical: "/portfolio" },
};

export default function PortfolioPage() {
  return (
    <PageShell
      eyebrow="Portfolio"
      title="Work that sells, live"
      intro="Campaigns, brands, and live sessions produced by A2Z Creative Marketing. Clients are shown anonymised unless they have given us permission to name them."
    >
      <LivePortfolio
        fallback={
          PORTFOLIO_ITEMS.length === 0 ? (
        <section>
          <p>
            We&apos;re preparing our client showcase — real sessions, real numbers,
            published with each brand&apos;s permission. It will land here soon.
          </p>
          <p className="mt-4">
            Meanwhile, the best portfolio is a live one:{" "}
            <a
              href={CONTACT.socials.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              watch us live on TikTok
            </a>{" "}
            and judge the craft in real time — or{" "}
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              ask us on WhatsApp
            </a>{" "}
            for recent session results.
          </p>
        </section>
          ) : (
            <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {PORTFOLIO_ITEMS.map((item) => {
                const card = (
                  <article className="h-full rounded-xl border border-border p-5 transition-colors group-hover:bg-secondary/40">
                    <h2 className="text-lg font-semibold text-foreground">
                      {item.client}
                    </h2>
                    <p className="mt-1 text-sm">{item.summary}</p>
                    <p className="text-gold-deep mt-3 text-sm font-medium">
                      {item.result}
                    </p>
                  </article>
                );
                return item.href ? (
                  <a
                    key={item.client}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block"
                    aria-label={`${item.client} — visit site`}
                  >
                    {card}
                  </a>
                ) : (
                  <div key={item.client}>{card}</div>
                );
              })}
            </section>
          )
        }
      />
    </PageShell>
  );
}
