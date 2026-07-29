"use client";

import { motion, useReducedMotion } from "framer-motion";

import { Editable } from "@/components/live/editable";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { whatsappUrl } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

function LiveBadge() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="AZ ONE OFFICIAL"
      className="mx-auto h-16 w-auto sm:h-20"
    />
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

      <motion.p
        {...fade(0.05)}
        className="text-gold-deep mt-6 text-xs font-medium tracking-[0.35em] uppercase"
      >
        {SITE_CONFIG.brandTagline}
      </motion.p>

      <motion.h1
        {...fade(0.1)}
        className="mt-4 max-w-3xl text-[2.1rem] leading-tight font-semibold tracking-tight text-balance sm:text-6xl"
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
              Helping brands increase sales through professional live hosts
              and complete TikTok Live commerce management.
            </>
          }
        />
      </motion.p>

      <motion.div
        {...fade(0.3)}
        className="mt-10 flex justify-center"
      >
        <ButtonGroup align="center">
          <Button href={whatsappUrl()} external>
            Get a free live audit
          </Button>
          <Button href="#packages" variant="outline">
            See packages
          </Button>
        </ButtonGroup>
      </motion.div>

      {/* Client strip — logos link to each brand's own site. The ELFIA mark
          is a temporary generated wordmark; swap the SVG when the official
          logo arrives (same path, no code change). */}
      <motion.div {...fade(0.4)} className="mt-14">
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
          Brands we run live for
        </p>
        <a
          href="https://elfiaofficialstore.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="ELFIA — visit elfiaofficialstore.com"
          className="mt-5 inline-flex opacity-90 transition-opacity hover:opacity-60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clients/elfia-wordmark.svg"
            alt="ELFIA"
            className="h-6 w-auto"
          />
        </a>
      </motion.div>
    </section>
  );
}
