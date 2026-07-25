import { Section } from "@/components/layout/section";
import { Reveal } from "@/components/ui/reveal";
import { SERVICES } from "@/constants/content";

export function Services() {
  return (
    <Section
      id="services"
      eyebrow="Services"
      title="Everything a brand needs to win live"
      intro="From your first trial session to a full monthly live schedule — pick a lane or hand us the whole channel."
      className="bg-brand-neutral"
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((service, i) => {
          const Icon = service.icon;
          return (
            <Reveal key={service.title} delay={(i % 3) * 0.08}>
              <article className="group h-full rounded-xl border border-border bg-background p-6 transition-shadow hover:shadow-sm">
                <span className="bg-brand text-gold inline-flex h-12 w-12 items-center justify-center rounded-lg">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">
                  {service.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {service.description}
                </p>
              </article>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
