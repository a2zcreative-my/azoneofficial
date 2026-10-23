"use client";

/* v1.197.0 - THE HERO, closer to the owner's mockup: full width, the copy on
   navy at the left and the picture running to the right edge, melting into
   the navy. The picture is the real photograph set in HOME_MEDIA.hero; until
   the owner sends one it is the studio, drawn - the A2Z sign on the wall, a
   ring light, the phone on its stand - and it says it is an illustration.
   On a phone the drawn studio is left out so the first screen is the offer
   and its two buttons; a real photograph shows under the copy.
   No invented viewers, orders or GMV.

   The headline and subheadline keep their Admin -> Content keys
   (home.hero.headline, home.hero.subheadline). */

import { ArrowRight, BarChart3, MapPin, Play, Users } from "lucide-react";

import { Editable } from "@/components/live/editable";
import { HOME_MEDIA, LIVE_SHOWCASE, whatsappUrl } from "@/constants/content";
import { CTA_LABEL } from "@/constants/site";

import css from "./home.module.css";

const handle = LIVE_SHOWCASE.tiktokProfileUrl.split("@")[1] ?? "";

function Studio() {
  return (
    <div className={css.studio} role="img" aria-label="Illustration of the A2Z live studio">
      <span className={css.softbox} aria-hidden="true" />
      <span className={`${css.beam} ${css.beamLeft}`} aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={css.wallSign} src="/logo-white.png" alt="" width={991} height={547} />
      <span className={css.ring} aria-hidden="true" />
      <div className={css.phone} aria-hidden="true">
        <div className={css.screen}>
          <div className={css.screenTop}>
            <span className={css.liveChip}><span className={css.liveDot} />LIVE</span>
            <span className={css.screenHandle} data-no-translate>@{handle}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={css.screenLogo} src="/logo-white.png" alt="" width={991} height={547} />
          <p className={css.screenTag}>Live commerce</p>
          <ul className={css.bubbles}>
            <li className={`${css.bubble} ${css.bubblePinned}`}>Pinned: Today-only bundle — checkout in cart</li>
            <li className={css.bubble}>&quot;sis, ada size M tak?&quot; — answered live, on camera</li>
          </ul>
        </div>
      </div>
      <span className={css.stand} aria-hidden="true" />
      <p className={css.stageNote}>Studio view — illustration</p>
    </div>
  );
}

export function Hero() {
  const photo = HOME_MEDIA.hero.src;
  return (
    <section id="top" className={`${css.hero} ${photo ? css.heroHasPhoto : ""}`}>
      <div className={`${css.heroMedia} ${css.rise} ${css.rise3}`}>
        {photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className={css.heroPhoto} src={photo} alt={HOME_MEDIA.hero.alt} fetchPriority="high" />
        ) : (
          <Studio />
        )}
        <span className={css.heroFade} aria-hidden="true" />
      </div>
      <div className={css.wrap}>
        <div className={css.heroCopy}>
          <p className={`${css.heroEyebrow} ${css.rise}`}>Creative • Digital • Commerce</p>
          <h1 className={`${css.heroTitle} ${css.rise} ${css.rise2}`}>
            <Editable
              k="home.hero.headline"
              fallback={
                <>
                  <span className={css.heroLine}>Build the brand.</span>{" "}
                  <span className={css.gold}>Sell it live.</span>
                </>
              }
            />
          </h1>
          <p className={`${css.heroLede} ${css.rise} ${css.rise3}`}>
            <Editable
              k="home.hero.subheadline"
              fallback="We help businesses grow through creative marketing, content production, professional live hosts and TikTok Live commerce management."
            />
          </p>
          <div className={`${css.btnRow} ${css.heroCtas} ${css.rise} ${css.rise4}`}>
            <a className={css.btnGold} href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
              <span>{CTA_LABEL}</span>
              <ArrowRight aria-hidden="true" />
            </a>
            <a className={css.btnGhost} href="#work">
              <span>Explore our work</span>
              <span className={css.btnIcon} aria-hidden="true"><Play /></span>
            </a>
          </div>
          <ul className={`${css.heroFacts} ${css.rise} ${css.rise5}`}>
            <li className={css.heroFact}>
              <MapPin aria-hidden="true" />
              <div><strong>Johor Bahru based</strong><span>Serving brands across Malaysia</span></div>
            </li>
            <li className={css.heroFact}>
              <Users aria-hidden="true" />
              <div><strong>BM &amp; English live hosts</strong><span>Trained to sell, not just present</span></div>
            </li>
            <li className={css.heroFact}>
              <BarChart3 aria-hidden="true" />
              <div><strong>Strategy to sales</strong><span>From content to conversion</span></div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
