import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { LivePortfolio } from "@/components/live/live-content";
import { CONTACT, whatsappUrl } from "@/constants/content";
import { PORTFOLIO_ITEMS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Brands and live sessions produced by AZ ONE OFFICIAL.",
};

export default function PortfolioPage() {
  return (
    <PageShell
      eyebrow="Portfolio"
      title="Work that sells, live"
      intro="Brands and live sessions produced by AZ ONE OFFICIAL."
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
            <section className="grid gap-6 sm:grid-cols-2">
              {PORTFOLIO_ITEMS.map((item) => (
                <article key={item.client} className="rounded-xl border border-border p-5">
                  <h2 className="text-lg font-semibold text-foreground">
                    {item.client}
                  </h2>
                  <p className="mt-1 text-sm">{item.summary}</p>
                  <p className="text-gold-deep mt-3 text-sm font-medium">{item.result}</p>
                </article>
              ))}
            </section>
          )
        }
      />
    </PageShell>
  );
}
