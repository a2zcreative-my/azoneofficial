import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
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
            <span className="bg-brand text-gold inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
              <Icon className="h-5 w-5" aria-hidden="true" />
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
    </PageShell>
  );
}
