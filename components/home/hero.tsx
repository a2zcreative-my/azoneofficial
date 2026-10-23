"use client";

/* v1.195.0 - THE HERO, on the owner's mockup: navy, the headline in two
   lines (the second in gold), the two calls to action, three facts that are
   true today, and a visual. The visual is a real photograph when one is set
   in HOME_MEDIA.hero; until then it is the studio panel - the A2Z mark on a
   phone at a session, with the session's own rhythm from the site's copy -
   and it says it is an illustration. No invented viewers, orders or GMV.

   The headline and subheadline keep their Admin -> Content keys
   (home.hero.headline, home.hero.subheadline). */

import { ArrowRight, BarChart3, ClipboardList, MapPin, Mic2, Play } from "lucide-react";

import { Editable } from "@/components/live/editable";
import { HOME_MEDIA, LIVE_SHOWCASE, whatsappUrl } from "@/constants/content";
import { CTA_LABEL } from "@/constants/site";

import css from "./home.module.css";

const handle = LIVE_SHOWCASE.tiktokProfileUrl.split("@")[1] ?? "";

function Stage() {
  const photo = HOME_MEDIA.hero.src;
  return (
    <div className={`${css.stage} ${css.rise} ${css.rise3}`}>
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={css.stagePhoto} src={photo} alt={HOME_MEDIA.hero.alt} fetchPriority="high" />
          <span className={css.stageShade} aria-hidden="true" />
        </>
      ) : (
        <>
          <span className={`${css.beam} ${css.beamLeft}`} aria-hidden="true" />
          <span className={`${css.beam} ${css.beamRight}`} aria-hidden="true" />
          <div className={css.phone} role="img" aria-label="Illustration of an A2Z live commerce session on a phone">
            <div className={css.screen}>
              <div className={css.screenTop}>
                <span className={css.liveChip}><span className={css.liveDot} aria-hidden="true" />LIVE</span>
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
        </>
      )}
      <div className={`${css.floatCard} ${css.floatA}`} aria-hidden={!photo}>
        <ClipboardList aria-hidden="true" />
        <span>Rundown loaded — host and producer on set</span>
      </div>
      <div className={`${css.floatCard} ${css.floatB}`} aria-hidden={!photo}>
        <BarChart3 aria-hidden="true" />
        <span>Post-live report: GMV, viewers, conversion, next actions</span>
      </div>
      {!photo && <p className={css.stageNote}>Session view — illustration</p>}
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className={css.hero}>
      <div className={`${css.wrap} ${css.heroGrid}`}>
        <div>
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
              fallback="Creative marketing, digital marketing, and content production — plus professional live hosts and complete TikTok Live commerce management. One Malaysian team, from the plan to the sale."
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
              <Mic2 aria-hidden="true" />
              <div><strong>BM &amp; English live hosts</strong><span>Trained to sell, not just present</span></div>
            </li>
            <li className={css.heroFact}>
              <BarChart3 aria-hidden="true" />
              <div><strong>Strategy to sales</strong><span>From content to conversion</span></div>
            </li>
          </ul>
        </div>
        <Stage />
      </div>
    </section>
  );
}
