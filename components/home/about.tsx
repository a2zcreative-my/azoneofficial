"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useEffect, useRef } from "react";

import { Section } from "@/components/layout/section";
import { Reveal } from "@/components/ui/reveal";
import { ABOUT, STATISTICS } from "@/constants/content";
import type { Statistic } from "@/types";

function StatCounter({ stat }: { stat: Statistic }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduceMotion = useReducedMotion();
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toString());

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      count.set(stat.value);
      return;
    }
    const controls = animate(count, stat.value, {
      duration: 1.6,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [inView, reduceMotion, count, stat.value]);

  return (
    <div className="border-t border-border pt-6">
      <p className="text-4xl font-semibold tracking-tight sm:text-5xl">
        <motion.span ref={ref}>{rounded}</motion.span>
        <span className="text-gold">{stat.suffix}</span>
      </p>
      <p className="text-muted-foreground mt-2 text-sm">{stat.label}</p>
    </div>
  );
}

export function About() {
  return (
    <Section id="about" eyebrow={ABOUT.eyebrow} title={ABOUT.title}>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <div className="space-y-5">
            {ABOUT.body.map((paragraph) => (
              <p
                key={paragraph}
                className="text-muted-foreground text-base leading-relaxed"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 lg:grid-cols-1 lg:content-start xl:grid-cols-3">
          {STATISTICS.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 0.1}>
              <StatCounter stat={stat} />
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
