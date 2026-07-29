"use client";

import { useEffect, useRef, useState } from "react";

import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Reveal } from "@/components/ui/reveal";
import { LIVE_SHOWCASE } from "@/constants/content";

/**
 * LiveShowcase (v1.4.0) — the closest a website can get to "embed our live".
 *
 * Platform constraint, stated plainly: TikTok does not allow a LIVE stream to
 * play inside another website (the /live page refuses to load in an iframe),
 * and there is no public API to ask "is this account live right now?". What
 * TikTok DOES support embedding is the creator profile — an official widget
 * showing the account with its latest videos, always current, no manual
 * updates. So this section:
 *
 *   1. leads with the /live CTA (TikTok routes it to the live room during a
 *      session, to the profile otherwise — correct in both states), and
 *   2. embeds the @azoneofficialhq profile widget, so a prospective client
 *      sees real, recent session content without leaving the page. If
 *      LIVE_SHOWCASE.videoUrl is set, that specific video embeds instead.
 *
 * A styled preview card covers loading and the no-network/blocked case, so
 * the section never shows a broken player.
 */

function tiktokVideoId(url: string): string | null {
  const match = /\/video\/(\d+)/.exec(url);
  return match ? match[1] : null;
}

function tiktokUsername(profileUrl: string): string {
  const match = /tiktok\.com\/@([^/?#]+)/.exec(profileUrl);
  return match ? match[1] : "";
}

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

/**
 * Renders TikTok's official embed. With a videoUrl → that video; without →
 * the creator profile widget (latest videos, always current).
 */
function TikTokEmbed() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const videoId = tiktokVideoId(LIVE_SHOWCASE.videoUrl);
  const profileUrl = LIVE_SHOWCASE.tiktokProfileUrl;
  const username = tiktokUsername(profileUrl);

  useEffect(() => {
    // TikTok's embed script scans for .tiktok-embed blockquotes and upgrades
    // them to iframes. Re-append it so it also runs after client navigation.
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    document.body.appendChild(script);

    const started = Date.now();
    const timer = window.setInterval(() => {
      const iframe = containerRef.current?.querySelector("iframe");
      if (iframe) {
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
            style={{ maxWidth: "605px", minWidth: "325px" }}
          >
            <section>
              <a
                href={LIVE_SHOWCASE.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Watch how an AZ ONE OFFICIAL live session comes together
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

export function LiveShowcase() {
  return (
    <Section
      id="live"
      dark
      eyebrow={LIVE_SHOWCASE.eyebrow}
      title={LIVE_SHOWCASE.title}
      intro={LIVE_SHOWCASE.intro}
    >
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <div>
            <ButtonGroup>
              <Button href={LIVE_SHOWCASE.tiktokLiveUrl} external variant="gold">
                Watch us live on TikTok
              </Button>
              {LIVE_SHOWCASE.shopeeLiveUrl && (
                <Button
                  href={LIVE_SHOWCASE.shopeeLiveUrl}
                  external
                  variant="outlineLight"
                >
                  Shopee Live
                </Button>
              )}
            </ButtonGroup>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-white/60">
              Not live at this moment? The feed beside shows our latest
              sessions and cuts — real hosts, real orders, real reporting.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <TikTokEmbed />
        </Reveal>
      </div>
    </Section>
  );
}
