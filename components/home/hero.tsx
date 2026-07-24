"use client";

import { motion, useReducedMotion } from "framer-motion";

import { Editable } from "@/components/live/editable";
import { whatsappUrl } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-1.5 text-xs font-medium tracking-[0.25em] uppercase">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="bg-gold absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none" />
        <span className="bg-gold relative inline-flex h-2 w-2 rounded-full" />
      </span>
      We sell live
    </span>
  );
}

export function Hero() {
  const reduceMotion = useReducedMotion();

  const fade = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.21, 0.47, 0.32, 0.98] as const },
        };

  return (
    <section
      id="top"
      className="flex min-h-[92svh] flex-col items-center justify-center px-6 pt-20 text-center sm:min-h-screen"
    >
      <motion.div {...fade(0)}>
        <LiveBadge />
      </motion.div>

      <motion.h1
        {...fade(0.1)}
        className="mt-8 max-w-3xl text-[2.1rem] leading-tight font-semibold tracking-tight text-balance sm:text-6xl"
      >
        <Editable
          k="home.hero.headline"
          fallback={
            <>
              Grow your sales through{" "}
              <span className="text-gold-deep">live commerce</span>
            </>
          }
        />
      </motion.h1>

      <motion.p
        {...fade(0.2)}
        className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed sm:text-lg"
      >
        <Editable
          k="home.hero.subheadline"
          fallback={
            <>
              Helping brands increase sales through professional live hosts and
              complete TikTok Live commerce management — home of{" "}
              <span className="font-medium text-foreground">
                {SITE_CONFIG.brand.fashion}
              </span>
              , our premium fashion brand.
            </>
          }
        />
      </motion.p>

      <motion.div
        {...fade(0.3)}
        className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
      >
        <a
          href={whatsappUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-12 items-center rounded-lg px-8 text-sm font-medium transition-colors"
        >
          Book free consultation
        </a>
        <a
          href="#services"
          className="inline-flex h-12 items-center rounded-lg border border-border px-8 text-sm font-medium transition-colors hover:bg-secondary"
        >
          See what we do
        </a>
      </motion.div>
    </section>
  );
}
