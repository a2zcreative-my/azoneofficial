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
      alt={SITE_CONFIG.name}
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
              Build the brand.{" "}
              <span className="text-gold-deep">Sell it live.</span>
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
              Creative marketing, digital marketing, and content production —
              plus professional live hosts and complete TikTok Live commerce
              management. One Malaysian team, from the plan to the sale.
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

      {/*
        v1.27.0 — the "Brands we run live for" client strip was removed with
        the client-confidentiality change. Client names and marks are only
        published with written permission; until we hold one, the hero ends
        on the CTAs. Re-adding it means re-adding a logo asset under
        /public/clients and a permission on file — not just this markup.
      */}
    </section>
  );
}
