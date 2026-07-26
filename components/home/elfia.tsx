import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ElfiaGallery } from "@/components/ui/elfia-gallery";
import { Reveal } from "@/components/ui/reveal";
import { CONTACT, ELFIA, ELFIA_PRODUCTS } from "@/constants/content";

export function Elfia() {
  return (
    <Section id="elfia" dark>
      <div className="grid items-center gap-12 lg:grid-cols-5 lg:gap-16">
        <div className="lg:col-span-2">
          <Reveal>
            <p className="text-gold mb-3 text-xs font-medium tracking-[0.3em] uppercase">
              {ELFIA.eyebrow}
            </p>
            <h2 className="text-4xl font-semibold tracking-[0.12em] sm:text-6xl sm:tracking-[0.15em]">
              {ELFIA.title}
            </h2>
            <p className="text-gold mt-3 text-base tracking-[0.14em] italic">
              {ELFIA.slogan}
            </p>
            <p className="mt-2 text-sm text-white/55 italic">
              {ELFIA.tagline}
            </p>
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70">
              {ELFIA.body}
            </p>
            <div className="mt-8">
              <Button href={CONTACT.socials.tiktok} external variant="gold">
                {ELFIA.cta}
              </Button>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-3">
          <Reveal delay={0.1}>
            <ElfiaGallery products={ELFIA_PRODUCTS} />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
