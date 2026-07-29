"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { ElfiaProduct } from "@/types";

/**
 * ElfiaGallery — coverflow carousel for ELFIA products (v1.2.8).
 * Centre card full size (and links to the product detail page); neighbours
 * peek behind at reduced scale; infinite wrap. Touch-swipe, arrow buttons,
 * keyboard arrows, aria-live announcements, motion-reduce respected.
 * No carousel dependency — pure transforms, static-export safe.
 */
export function ElfiaGallery({
  products,
  autoPlay = true,
  interval = 3500,
}: {
  products: readonly ElfiaProduct[];
  /** Advance on its own; manual controls always remain available. */
  autoPlay?: boolean;
  /** Milliseconds between automatic advances. */
  interval?: number;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // Bumped on any manual input so the timer restarts from that moment
  const [nudge, setNudge] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [offScreen, setOffScreen] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  const count = products.length;
  const go = useCallback(
    (dir: number) => {
      setActive((i) => (i + dir + count) % count);
      setNudge((n) => n + 1);
    },
    [count],
  );

  const goTo = useCallback((index: number) => {
    setActive(index);
    setNudge((n) => n + 1);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    setSwiping(true);
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (Math.abs(touchDeltaX.current) > 48) go(touchDeltaX.current < 0 ? 1 : -1);
    touchStartX.current = null;
    touchDeltaX.current = 0;
    setSwiping(false);
    setNudge((n) => n + 1);
  };

  // Fires instead of touchend when the browser takes the gesture over as a
  // page scroll — without this the carousel stayed paused for good.
  const onTouchCancel = () => {
    touchStartX.current = null;
    touchDeltaX.current = 0;
    setSwiping(false);
  };

  // Autoplay — paused on hover/focus/touch, when the tab is hidden, when the
  // carousel is off screen, and entirely for prefers-reduced-motion users.
  useEffect(() => {
    if (!autoPlay || paused || swiping || offScreen || tabHidden || count <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(
      () => setActive((i) => (i + 1) % count),
      interval,
    );
    return () => window.clearInterval(id);
  }, [autoPlay, paused, swiping, offScreen, tabHidden, count, interval, nudge, active]);

  // Safety net: no combination of stuck events should be able to pause the
  // carousel forever. If paused/swiping persists with no further interaction,
  // resume after 6s.
  useEffect(() => {
    if (!autoPlay || (!paused && !swiping)) return;
    const id = window.setTimeout(() => {
      setPaused(false);
      setSwiping(false);
    }, 6000);
    return () => window.clearTimeout(id);
  }, [autoPlay, paused, swiping]);

  // Don't animate in a background tab
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Don't animate while scrolled past
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOffScreen(!entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Preload the neighbours of the active slide
  useEffect(() => {
    [active - 1, active + 1].forEach((i) => {
      const p = products[(i + count) % count];
      if (p?.imageSrc) {
        const img = new window.Image();
        img.src = p.imageSrc;
      }
    });
  }, [active, count, products]);

  return (
    <div
      ref={rootRef}
      className="relative select-none"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setPaused(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setPaused(false);
      }}
      onFocusCapture={(e) => {
        // Keyboard focus pauses; a tap or click on the arrows must not
        try {
          if (
            e.target instanceof HTMLElement &&
            e.target.matches(":focus-visible")
          ) {
            setPaused(true);
          }
        } catch {
          // :focus-visible unsupported — skip the pause rather than throw
        }
      }}
      onBlurCapture={() => setPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label="ELFIA product gallery"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div
        className="relative h-[440px] w-full touch-pan-y overflow-hidden sm:h-[500px]"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {products.map((product, i) => {
          // Signed shortest distance from the active card (wraps around)
          let offset = i - active;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;

          const abs = Math.abs(offset);
          const visible = abs <= 2;
          const isCenter = offset === 0;

          const card = (
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]">
              <span className="text-foreground absolute top-4 left-4 z-10 rounded-md bg-white/90 px-3 py-1 text-xs font-medium">
                {product.category}
              </span>
              <div className="relative aspect-[3/4]">
                {product.imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageSrc}
                    alt={product.imageAlt}
                    className="h-full w-full object-cover"
                    loading={isCenter ? "eager" : "lazy"}
                  />
                ) : (
                  <div
                    role="img"
                    aria-label={product.imageAlt}
                    className="flex h-full w-full items-center justify-center"
                  >
                    <span className="text-gold text-5xl font-light tracking-[0.3em]">
                      E
                    </span>
                  </div>
                )}
              </div>
            </div>
          );

          return (
            <figure
              key={product.slug}
              aria-hidden={!isCenter}
              className="absolute top-1/2 left-1/2 w-[72%] max-w-[260px] transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none sm:w-[52%] sm:max-w-[320px]"
              style={{
                transform: `translate(-50%, -50%) translateX(${offset * 62}%) scale(${1 - abs * 0.14})`,
                zIndex: 10 - abs,
                opacity: visible ? 1 - abs * 0.25 : 0,
                pointerEvents: visible ? "auto" : "none",
              }}
            >
              {isCenter ? (
                <Link
                  href="/portfolio/elfia"
                  className="group block cursor-pointer"
                  aria-label={`${product.name} — view the ELFIA case study`}
                >
                  {card}
                  <figcaption className="mt-4 text-center text-base font-medium text-white group-hover:underline">
                    {product.name}
                  </figcaption>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Show ${product.name}`}
                  className="block w-full cursor-pointer text-left"
                >
                  {card}
                </button>
              )}
            </figure>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous product"
          className="hover:bg-gold flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:border-transparent hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          {products.map((p, i) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to ${p.name}`}
              aria-current={i === active}
              className="group flex h-6 w-4 items-center justify-center"
            >
              <span
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === active ? "bg-gold w-5" : "w-1.5 bg-white/25 group-hover:bg-white/50"
                }`}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next product"
          className="hover:bg-gold flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:border-transparent hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <p className="sr-only" aria-live={autoPlay && !paused ? "off" : "polite"}>
        Showing item {active + 1} of {count}: {products[active]?.name}
      </p>
    </div>
  );
}
