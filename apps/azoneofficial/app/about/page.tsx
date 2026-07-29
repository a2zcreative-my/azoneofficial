import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Button, ButtonGroup, PageShell } from "@azone/ui";

import { ABOUT, TRUST_SIGNALS, whatsappUrl } from "@/constants/content";
import { WHY_CHOOSE_US } from "@/constants/pages";
import { SITE_CONFIG } from "@/constants/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "AZ ONE OFFICIAL is a Malaysian live commerce agency in Johor Bahru — and the home of the ELFIA hijab brand.",
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <PageShell eyebrow="About us" title={ABOUT.title}>
      {/*
        Two columns: the story reads on the left, the facts a prospect wants to
        verify sit on the right. Previously this page was a single narrow
        column inside the 6xl frame, leaving the right half empty.
      */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-16">
        <div className="space-y-5">
          {ABOUT.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p>
            We are based at {SITE_CONFIG.address}, and we work with brands
            across Malaysia.
          </p>
        </div>

        <aside className="bg-secondary/50 h-fit rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold tracking-tight">
            The short version
          </h2>
          <dl className="mt-5 space-y-5">
            {TRUST_SIGNALS.map((signal) => (
              <div key={signal.label}>
                <dt className="text-sm font-semibold">{signal.label}</dt>
                <dd className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {signal.description}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <section>
        <h2>Why brands choose us</h2>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_CHOOSE_US.map(({ title, description, icon: Icon }) => (
            <li
              key={title}
              className="flex h-full flex-col rounded-xl border border-border p-5"
            >
              <span className="bg-brand text-gold inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
              </span>
              <h3 className="text-foreground mt-4 text-base font-semibold">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed">{description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Want to see how this applies to your brand?</h2>
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
