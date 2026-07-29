"use client";

import { Editable, useStatistics } from "@azone/cms";
import { Reveal, Section } from "@azone/ui";

import { ABOUT, TRUST_SIGNALS } from "@/constants/content";

/**
 * Credibility block.
 *
 * Statistics are published from Admin → Content (`stats.items`, a JSON array
 * of {value,label}) rather than hard-coded. Values render as text, so an
 * editor can publish "500+", "3x" or "RM1.2M" without a code change — and the
 * old count-up animation is gone, which is what previously rendered
 * unpublished figures as "0+ / 0 / 0x".
 *
 * Until real numbers exist, the qualitative trust signals show instead.
 */
function Statistics({
  stats,
}: {
  stats: { value: string; label: string }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 lg:grid-cols-1 lg:content-start xl:grid-cols-3">
      {stats.map((stat, i) => (
        <Reveal key={stat.label} delay={i * 0.1}>
          <div className="border-border border-t pt-6">
            <p className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {stat.value}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">{stat.label}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function TrustSignals() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1 lg:content-start xl:grid-cols-2">
      {TRUST_SIGNALS.map((signal, i) => (
        <Reveal key={signal.label} delay={i * 0.08}>
          <div className="border-border border-t pt-5">
            <p className="text-base font-semibold tracking-tight">
              <span className="text-gold-deep mr-2" aria-hidden="true">
                —
              </span>
              {signal.label}
            </p>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {signal.description}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

export function About() {
  const stats = useStatistics();
  const hasStats = (stats?.length ?? 0) > 0;

  return (
    <Section id="about" eyebrow={ABOUT.eyebrow} title={ABOUT.title}>
      {/* Editable keys: about.body1, about.body2 (Admin → Content) */}
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <div className="space-y-5">
            {ABOUT.body.map((paragraph, i) => (
              <p
                key={paragraph}
                className="text-muted-foreground text-base leading-relaxed"
              >
                <Editable k={`about.body${i + 1}`} fallback={paragraph} />
              </p>
            ))}
          </div>
        </Reveal>

        {hasStats ? <Statistics stats={stats!} /> : <TrustSignals />}
      </div>
    </Section>
  );
}
