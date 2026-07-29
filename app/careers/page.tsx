import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { whatsappUrl } from "@/constants/content";
import { CAREERS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Join AZ ONE OFFICIAL — live hosts, live operations, and creative roles in Johor Bahru.",
};

export default function CareersPage() {
  return (
    <PageShell eyebrow="Careers" title="Sell live with us">
      <section>
        <p>{CAREERS.intro}</p>
      </section>
      <section>
        <h2>We&apos;re always interested in</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          {CAREERS.interests.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <p>
          {CAREERS.cta}{" "}
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            WhatsApp us here
          </a>
          .
        </p>
      </section>
    </PageShell>
  );
}
