import { CheckCircle2 } from "lucide-react";

import { Section } from "@/components/layout/section";
import { LiveTestimonials } from "@/components/live/live-content";
import { Reveal } from "@/components/ui/reveal";
import { TESTIMONIALS } from "@/constants/content";

const DELIVERABLES = [
  "Session rundown built around your best offers",
  "Trained host + producer on every live",
  "Real-time moderation and order push",
  "Post-live report: GMV, viewers, conversion, next actions",
] as const;

export function Showcase() {
  return (
    <Section
      id="showcase"
      eyebrow="Showcase"
      title="What a session with us looks like"
      intro="No mystery, no vanity metrics. Every live session is planned, produced, and reported like a campaign."
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <ul className="space-y-4">
            {DELIVERABLES.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2
                  className="text-gold-deep mt-0.5 h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <span className="text-base leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rounded-xl border border-border bg-brand-neutral p-8">
            <p className="text-xs font-medium tracking-[0.25em] uppercase">
              <span className="text-gold-deep">●</span> Live session, simulated view
            </p>
            <div className="mt-6 space-y-3 text-sm">
              <p className="rounded-lg bg-background px-4 py-3">
                🛒 Pinned: Today-only bundle — checkout in cart
              </p>
              <p className="rounded-lg bg-background px-4 py-3">
                💬 &ldquo;sis, ada size M tak?&rdquo; — answered live, on camera
              </p>
              <p className="rounded-lg bg-background px-4 py-3">
                📦 Order #214 confirmed while the host styles the next look
              </p>
            </div>
            <p className="text-muted-foreground mt-6 text-xs">
              This is the rhythm of a managed live: pitch, answer, close —
              repeated for two hours.
            </p>
          </div>
        </Reveal>
      </div>

      <LiveTestimonials />

      {TESTIMONIALS.length > 0 && (
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.slice(0, 3).map((t, i) => (
            <Reveal key={t.author} delay={i * 0.08}>
              <figure className="h-full rounded-xl border border-border p-6">
                <blockquote className="text-sm leading-relaxed">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="text-muted-foreground mt-4 text-xs">
                  <span className="font-medium text-foreground">
                    {t.author}
                  </span>{" "}
                  — {t.role}, {t.company}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  );
}
