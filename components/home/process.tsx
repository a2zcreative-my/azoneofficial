import { Section } from "@/components/layout/section";
import { Reveal } from "@/components/ui/reveal";
import { PROCESS } from "@/constants/content";

export function Process() {
  return (
    <Section
      id="process"
      eyebrow="Process"
      title="From first call to first sale"
      intro="Four steps. The order matters — each one feeds the next."
      className="bg-brand-neutral"
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PROCESS.map((step, i) => (
          <Reveal key={step.step} delay={i * 0.1}>
            <li className="h-full rounded-xl border border-border bg-background p-6">
              <span className="text-gold-deep text-sm font-semibold tracking-[0.2em]">
                {String(step.step).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {step.description}
              </p>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
