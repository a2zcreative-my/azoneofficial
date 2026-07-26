import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Reveal } from "@/components/ui/reveal";
import { PACKAGES, whatsappUrl } from "@/constants/content";

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gold-deep mt-0.5 h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Packages (v1.2.18) — publishes the tiers so visitors can see what they'd be
 * buying. Prices are intentionally omitted: quotes are per brand, and the page
 * sells the consultation. Showing scope without price still removes most of
 * the "I have no idea what this involves" hesitation.
 */
export function Packages() {
  return (
    <Section
      id="packages"
      eyebrow="Packages"
      title="Pick the level of support you need"
      intro="Every engagement starts with a free live audit — we look at your products and current channel, then recommend a tier. Pricing is quoted per brand, so you only pay for the cadence and creative you actually use."
    >
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {PACKAGES.map((tier, i) => (
          <Reveal key={tier.name} delay={i * 0.08}>
            <article
              className={`flex h-full flex-col rounded-xl border p-6 ${
                tier.featured
                  ? "border-gold-deep/40 bg-secondary/40 shadow-sm"
                  : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight">
                  {tier.name}
                </h3>
                {tier.featured && (
                  <span className="bg-brand text-gold rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                    Most chosen
                  </span>
                )}
              </div>

              <p className="text-gold-deep mt-2 text-sm font-medium">
                {tier.cadence}
              </p>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {tier.tagline}
              </p>

              <ul className="mt-6 grow space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check />
                    <span className="text-muted-foreground text-sm leading-relaxed">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </div>

      <div className="mt-10">
        <ButtonGroup>
        <Button href="/packages">Compare packages</Button>
        <Button href={whatsappUrl()} external variant="outline">
          Get a free live audit
        </Button>
        </ButtonGroup>
      </div>
    </Section>
  );
}
