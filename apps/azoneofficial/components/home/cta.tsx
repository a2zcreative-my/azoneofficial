import { Editable } from "@azone/cms";
import { Button, ButtonGroup, Reveal, Section } from "@azone/ui";
import { whatsappUrl } from "@/constants/content";

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
            Start with a free live audit: we review your products, your current
            channel, and what your buyers respond to — then tell you whether
            live is worth it for you. No commitment, no pressure.
          </p>
          <div className="mt-8 flex justify-center">
            <ButtonGroup align="center">
            <Button href={whatsappUrl()} external>
              Get a free live audit
            </Button>
            <Button href="/contact" variant="outline">
              Book a strategy call
            </Button>
            </ButtonGroup>
          </div>
          <p className="text-muted-foreground mt-4 text-sm">
            Prefer to just message us?{" "}
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground font-medium underline"
            >
              WhatsApp us now
            </a>
            .
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
