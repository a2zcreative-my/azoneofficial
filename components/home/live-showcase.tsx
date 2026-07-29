"use client";

import { useEffect, useRef, useState } from "react";

import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Reveal } from "@/components/ui/reveal";
import { LIVE_SHOWCASE } from "@/constants/content";

/**
 * LiveShowcase (v1.3.3) — homepage section that sends visitors to the live
 * room and shows the process on video.
 *
 * Platform reality this design accepts: TikTok/Shopee LIVE streams cannot be
 * embedded on an external site, and there is no public "live now?" API a
 * static export could poll. The /live URL does the routing for us — it opens
 * the live room during a session and the profile otherwise — so the primary
 * CTA is always correct without any status detection.
 *
 * The visual slot holds TikTok's official video embed (blockquote +
 * embed.js) when LIVE_SHOWCASE.videoUrl is set. While it is "", or while the
 * embed script is still loading, a styled preview card renders instead — the
 * section never shows a broken iframe.
 */

/** Extract the numeric video id from a TikTok video URL. */
function tiktokVideoId(url: string): string | null {
  const match = /\/video\/(\d+)/.exec(url);
  return match ? (match[1] ?? null) : null;
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

function TikTokEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const videoId = tiktokVideoId(url);

  useEffect(() => {
    if (!videoId) return;
    // TikTok's embed script scans for .tiktok-embed blockquotes on load and
    // upgrades them to iframes. Re-append it so it also runs after client
    // navigation, not just on a full page load.
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    document.body.appendChild(script);

    // Reveal the slot once the iframe exists; poll briefly, then give up
    // gracefully (the preview card stays if the embed never materialises).
    const started = Date.now();
    const timer = window.setInterval(() => {
      const iframe = containerRef.current?.querySelector("iframe");
      if (iframe) {
        setReady(true);
        window.clearInterval(timer);
      } else if (Date.now() - started > 8000) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      script.remove();
    };
  }, [videoId]);

  if (!videoId) return <LivePreviewCard />;

  return (
    <div>
      {!ready && <LivePreviewCard />}
      <div ref={containerRef} className={ready ? "" : "sr-only"}>
        <blockquote
          className="tiktok-embed !m-0"
          cite={url}
          data-video-id={videoId}
          style={{ maxWidth: "605px", minWidth: "325px" }}
        >
          <section>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Watch how an AZ ONE OFFICIAL live session comes together
            </a>
          </section>
        </blockquote>
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
              Not live right now? The video shows how a managed session runs —
              rundown, pitch, moderation, and orders confirmed on camera.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <TikTokEmbed url={LIVE_SHOWCASE.videoUrl} />
        </Reveal>
      </div>
    </Section>
  );
}
