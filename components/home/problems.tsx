import { Section } from "@/components/layout/section";
import { Reveal } from "@/components/ui/reveal";
import { PROBLEMS } from "@/constants/content";

/**
 * Problems (v1.4.0) — the pains that bring brands to an agency, each answered
 * with how AZ ONE solves it. Sits between About and Services so the flow
 * reads: who we are → what hurts → what we do about it → how it's packaged.
 * Cards are equal weight by design; copy in constants is written to length.
 */
export function Problems() {
  return (
    <Section
      id="problems"
      eyebrow="Sound familiar?"
      title="The problems we solve, live"
      intro="Most brands don't fail at live commerce because the product is wrong — they fail at the parts nobody warned them about. These are the ones we get hired for."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6">
        {PROBLEMS.map((item, i) => (
          <Reveal key={item.problem} delay={i * 0.06} className="h-full">
            <article className="flex h-full flex-col rounded-xl border border-border p-6 lg:p-7">
              <p className="text-base font-semibold text-foreground">
                &ldquo;{item.problem}&rdquo;
              </p>
              <p className="text-gold-deep mt-4 text-xs font-medium tracking-[0.25em] uppercase">
                How we solve it
              </p>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {item.solution}
              </p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
