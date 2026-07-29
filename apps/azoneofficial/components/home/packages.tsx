import { PACKAGES, whatsappUrl } from "@/constants/content";
import { PackageCard } from "@/components/packages/package-card";
import { Button, ButtonGroup, ScrollCarousel, Section } from "@azone/ui";

/**
 * Packages (v1.2.21) — carousel teaser on the homepage. Full detail and the
 * comparison matrix live on /packages; this section exists to show the tiers
 * exist and route people there.
 */
export function Packages() {
  return (
    <Section
      id="packages"
      eyebrow="Packages"
      title="Pick the level of support you need"
      intro="Every engagement starts with a free live audit — we look at your products and current channel, then recommend a tier. Pricing is quoted per brand, so you only pay for the cadence and creative you actually use."
    >
      <ScrollCarousel label="Package tiers">
          {PACKAGES.map((tier) => (
            <PackageCard key={tier.name} tier={tier} />
          ))}
        </ScrollCarousel>

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
