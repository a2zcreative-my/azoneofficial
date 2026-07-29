import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

import { PageShell } from "@azone/ui";
import { whatsappUrl } from "@/constants/content";
import { CASE_STUDIES } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Case Studies",
  description:
    "How AZ ONE OFFICIAL grows brand sales through live commerce — challenge, approach, result.",
};

export default function CaseStudiesPage() {
  return (
    <>
      <Navbar />
      <PageShell eyebrow="Case studies" title="Challenge, approach, result">
      {CASE_STUDIES.length === 0 ? (
        <section>
          <p>
            Our first written case studies are in preparation. Each one will
            follow the same honest format: the challenge a brand came with, the
            approach we ran, and the numbers that came out.
          </p>
          <p className="mt-4">
            Want to be one of them?{" "}
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline"
            >
              Book a free consultation
            </a>
            .
          </p>
        </section>
      ) : (
        <section className="space-y-8">
          {CASE_STUDIES.map((cs) => (
            <article key={cs.title} className="rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold text-foreground">{cs.title}</h2>
              <p className="text-gold mt-1 text-sm">{cs.client}</p>
              <dl className="mt-4 space-y-3 text-sm">
                <div><dt className="font-medium text-foreground">Challenge</dt><dd>{cs.challenge}</dd></div>
                <div><dt className="font-medium text-foreground">Approach</dt><dd>{cs.approach}</dd></div>
                <div><dt className="font-medium text-foreground">Result</dt><dd>{cs.result}</dd></div>
              </dl>
            </article>
          ))}
        </section>
      )}
      </PageShell>
      <Footer />
    </>
  );
}
