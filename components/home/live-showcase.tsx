"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/ui/reveal";
import { LIVE_SHOWCASE } from "@/constants/content";

import css from "./home.module.css";

/**
 * LiveShowcase (v1.4.1) — our live channels, side by side.
 *
 * Why the two panels are built differently (see LIVE_SHOWCASE in
 * constants/content.ts for the full note): TikTok publishes an official
 * creator embed, so its panel shows real content in-page. Shopee blocks
 * framing entirely (`X-Frame-Options`) and publishes no embed API, so an
 * iframe there would render blank — its panel is a branded channel card that
 * links straight to the shop, where the live badge appears during a session.
 *
 * Neither platform exposes a "live now?" API, so both CTAs are written to be
 * correct whether or not a session is running.
 */

function tiktokVideoId(url: string): string | null {
  const match = /\/video\/(\d+)/.exec(url);
  return match ? (match[1] ?? null) : null;
}

function tiktokUsername(profileUrl: string): string {
  const match = /tiktok\.com\/@([^/?#]+)/.exec(profileUrl);
  return match ? (match[1] ?? "") : "";
}

/** Shown while the TikTok embed loads, or if it never arrives. */
function LivePreviewCard() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-8">
      <p className="text-xs font-medium tracking-[0.25em] text-white/60 uppercase">
        <span className="relative mr-2 inline-flex h-2 w-2">
          <span className="bg-gold absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" />
          <span className="bg-gold relative inline-flex h-2 w-2 rounded-full" />
        </span>
        Live commerce, in session
      </p>
      <div className="mt-6 space-y-3 text-sm">
        <p className="rounded-lg bg-white/[0.06] px-4 py-3 text-white/80">
          🎬 Rundown loaded — host and producer on set
        </p>
        <p className="rounded-lg bg-white/[0.06] px-4 py-3 text-white/80">
          🛒 Offers pinned, moderation live, orders pushed in real time
        </p>
        <p className="rounded-lg bg-white/[0.06] px-4 py-3 text-white/80">
          📊 Post-live report: GMV, viewers, conversion, next actions
        </p>
      </div>
      <p className="mt-6 text-xs text-white/50">{LIVE_SHOWCASE.scheduleNote}</p>
    </div>
  );
}

function TikTokEmbed() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const videoId = tiktokVideoId(LIVE_SHOWCASE.videoUrl);
  const profileUrl = LIVE_SHOWCASE.tiktokProfileUrl;
  const username = tiktokUsername(profileUrl);

  useEffect(() => {
    // TikTok's script scans for .tiktok-embed blockquotes and upgrades them
    // to iframes. Re-append it so it also runs after client navigation.
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    document.body.appendChild(script);

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (containerRef.current?.querySelector("iframe")) {
        setReady(true);
        window.clearInterval(timer);
      } else if (Date.now() - started > 10000) {
        window.clearInterval(timer); // preview card stays
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      script.remove();
    };
  }, []);

  return (
    <div>
      {!ready && <LivePreviewCard />}
      <div ref={containerRef} className={ready ? "" : "sr-only"}>
        {videoId ? (
          <blockquote
            className="tiktok-embed !m-0"
            cite={LIVE_SHOWCASE.videoUrl}
            data-video-id={videoId}
            style={{ maxWidth: "605px", minWidth: "288px" }}
          >
            <section>
              <a
                href={LIVE_SHOWCASE.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Watch how an A2Z live session comes together
              </a>
            </section>
          </blockquote>
        ) : (
          <blockquote
            className="tiktok-embed !m-0"
            cite={profileUrl}
            data-unique-id={username}
            data-embed-type="creator"
            style={{ maxWidth: "780px", minWidth: "288px" }}
          >
            <section>
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                @{username} on TikTok
              </a>
            </section>
          </blockquote>
        )}
      </div>
    </div>
  );
}

/**
 * Shopee channel panel. Shopee cannot be embedded — this is a branded card
 * that carries the same information an embed would, and links to the shop
 * where the live badge appears during a session.
 */
function ShopeePanel() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.04] p-8">
      <p className="text-xs font-medium tracking-[0.25em] text-white/60 uppercase">
        Shopee Live
      </p>
      <p className="mt-3 text-lg font-semibold text-white">
        shopee.com.my/{LIVE_SHOWCASE.shopeeHandle}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-white/65">
        We run sessions on Shopee Live too — same rundown, same host
        discipline, with checkout happening inside Shopee. Open the shop to
        catch the live badge when a session is running, or browse what we sell
        between drops.
      </p>
      <ul className="mt-6 space-y-2.5 text-sm text-white/70">
        <li className="flex gap-2.5">
          <span className="text-gold mt-px" aria-hidden="true">
            ✓
          </span>
          In-app checkout, vouchers, and shop campaigns
        </li>
        <li className="flex gap-2.5">
          <span className="text-gold mt-px" aria-hidden="true">
            ✓
          </span>
          Sessions scheduled alongside the TikTok calendar
        </li>
        <li className="flex gap-2.5">
          <span className="text-gold mt-px" aria-hidden="true">
            ✓
          </span>
          Same post-live reporting: GMV, viewers, conversion
        </li>
      </ul>
      <div className="mt-auto pt-8">
        {/* v1.195.0 - the homepage's pill buttons */}
        <a href={LIVE_SHOWCASE.shopeeLiveUrl} target="_blank" rel="noopener noreferrer" className={`${css.btnGhost} ${css.wide}`}>
          <span>Watch on Shopee Live</span>
        </a>
      </div>
    </div>
  );
}

export function LiveShowcase() {
  const hasShopee = Boolean(LIVE_SHOWCASE.shopeeLiveUrl);

  return (
    /* v1.195.0 - the homepage's dark band and heading; the two panels and
       their platform rules are as they were */
    <section id="live" className={css.liveBand}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.heroEyebrow}>{LIVE_SHOWCASE.eyebrow}</p>
            <h2 className={css.h2}>{LIVE_SHOWCASE.title}</h2>
          </div>
          <p className={`${css.lede} ${css.ledeOnDark}`}>{LIVE_SHOWCASE.intro}</p>
        </div>
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
        {/* TikTok — official creator embed */}
        <Reveal className="h-full">
          <div className="flex h-full flex-col">
            <div className="flex-1">
              <TikTokEmbed />
            </div>
            <div className="pt-6">
              <a href={LIVE_SHOWCASE.tiktokLiveUrl} target="_blank" rel="noopener noreferrer" className={`${css.btnGold} ${css.wide}`}>
                <span>Watch us live on TikTok</span>
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </Reveal>

        {/* Shopee — branded channel card (platform blocks embedding) */}
        {hasShopee && (
          <Reveal delay={0.1} className="h-full">
            <ShopeePanel />
          </Reveal>
        )}
      </div>

      <p className="mt-8 text-sm leading-relaxed text-white/55">
        Not live at this moment? The TikTok feed shows our latest sessions and
        cuts — real hosts, real orders, real reporting.
      </p>
      </div>
    </section>
  );
}
