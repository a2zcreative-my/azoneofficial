import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { PackagesCarousel } from "@/components/ui/packages-carousel";
import { PACKAGES, whatsappUrl } from "@/constants/content";

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
      intro="Our live commerce service is sold in four tiers; creative, digital marketing, and consultancy are scoped per brief. Every engagement starts with a free live audit — we look at your products and current channels, then recommend a tier. Pricing is quoted per brand, so you only pay for the cadence and creative you actually use."
    >
      <PackagesCarousel packages={PACKAGES} />

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
