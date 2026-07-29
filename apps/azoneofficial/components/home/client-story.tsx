import Link from "next/link";
import { Button, Reveal, Section } from "@azone/ui";


import { FEATURED_CASE_STUDY } from "@/constants/content";

/**
 * Featured client success story on the homepage.
 *
 * Structured as Challenge → Solution → Results → CTA, because that is the
 * sequence a prospect uses to decide whether our work transfers to their
 * brand. Previously this slot held our own product brand, which told a
 * visitor nothing about what we do for clients.
 */
export function ClientStory() {
  const study = FEATURED_CASE_STUDY;

  return (
    <Section
      id="client-story"
      eyebrow="Client success story"
      title={`How we built ${study.client}'s live channel`}
      intro={study.summary}
    >
      <div className="grid gap-10 lg:grid-cols-3">
        <Reveal>
          <article className="border-border h-full rounded-xl border p-6">
            <h3 className="text-gold-deep text-xs font-semibold tracking-[0.28em] uppercase">
              Challenge
            </h3>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {study.challenge[0]}
            </p>
          </article>
        </Reveal>

        <Reveal delay={0.08}>
          <article className="border-border h-full rounded-xl border p-6">
            <h3 className="text-gold-deep text-xs font-semibold tracking-[0.28em] uppercase">
              Solution
            </h3>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {study.solution[0]}
            </p>
          </article>
        </Reveal>

        <Reveal delay={0.16}>
          <article className="border-gold-deep/40 bg-secondary/40 h-full rounded-xl border p-6">
            <h3 className="text-gold-deep text-xs font-semibold tracking-[0.28em] uppercase">
              Results
            </h3>
            <ul className="mt-4 space-y-3">
              {study.results.map((result) => (
                <li key={result.label}>
                  <p className="text-sm font-medium">{result.label}</p>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {result.detail}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        </Reveal>
      </div>

      {study.quote && (
        <Reveal delay={0.2}>
          <blockquote className="border-gold-deep/50 mt-10 border-l-2 pl-5">
            <p className="text-base leading-relaxed italic">
              &ldquo;{study.quote.text}&rdquo;
            </p>
            <footer className="text-muted-foreground mt-2 text-sm">
              — {study.quote.attribution}
            </footer>
          </blockquote>
        </Reveal>
      )}

      <div className="mt-10">
        <Button href={`/portfolio/${study.slug}`}>
          View the {study.client} case study
        </Button>
      </div>

      <p className="text-muted-foreground mt-4 text-sm">
        See all of our{" "}
        <Link href="/portfolio" className="text-foreground font-medium underline">
          client results
        </Link>
        .
      </p>
    </Section>
  );
}
