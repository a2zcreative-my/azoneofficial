import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { ABOUT } from "@/constants/content";
import { WHY_CHOOSE_US } from "@/constants/pages";
import { SITE_CONFIG } from "@/constants/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "AZ ONE OFFICIAL is a Malaysian live commerce agency in Johor Bahru — and the home of the ELFIA fashion brand.",
};

export default function AboutPage() {
  return (
    <PageShell eyebrow="About us" title={ABOUT.title}>
      <section className="space-y-5">
        {ABOUT.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>
          We are based at {SITE_CONFIG.address}, and we work with brands across
          Malaysia.
        </p>
      </section>

      <section>
        <h2>Why brands choose us</h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2">
          {WHY_CHOOSE_US.map(({ title, description, icon: Icon }) => (
            <li key={title} className="rounded-xl border border-border p-5">
              <span className="bg-gold-soft inline-flex h-10 w-10 items-center justify-center rounded-lg">
                <Icon className="h-5 w-5 text-black" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-1 text-sm">{description}</p>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
