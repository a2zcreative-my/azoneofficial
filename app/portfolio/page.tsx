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
      intro="Campaigns, brands, and live sessions produced by A2Z Creative Marketing. Named with each brand’s permission; everyone else stays anonymous."
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
                    {/* v1.32.0 — named entries carry their mark. The logo box
                        keeps a fixed height so cards line up whether or not an
                        entry has one. */}
                    {item.logo && (
                      <div className="mb-3 flex h-10 items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.logo} alt={item.client} className="max-h-9 w-auto max-w-[190px] object-contain" />
                      </div>
                    )}
                    <h2 className="text-lg font-semibold text-foreground">
                      {item.client}
                    </h2>
                    {item.role && (
                      <p className="text-muted-foreground mt-0.5 text-xs font-medium tracking-wide uppercase">
                        {item.role}
                      </p>
                    )}
                    <p className="mt-2 text-sm">{item.summary}</p>
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
