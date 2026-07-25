import { Section } from "@/components/layout/section";
import { Editable } from "@/components/live/editable";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { whatsappUrl } from "@/constants/content";
import { CTA_LABEL } from "@/constants/site";

export function Cta() {
  return (
    <Section id="contact" className="bg-brand-neutral">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">
            Ready when you are
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            <Editable
              k="home.cta.heading"
              fallback="Your next customer is already watching a live. Make it yours."
            />
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">
            Book a short consultation on WhatsApp — we'll review your brand and
            recommend the right starting package. No commitment, no pressure.
          </p>
          <div className="mt-8">
            <Button href={whatsappUrl()} external>
              {CTA_LABEL}
            </Button>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
