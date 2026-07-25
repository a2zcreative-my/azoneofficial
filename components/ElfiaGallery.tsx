"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

/**
 * ElfiaGallery — coverflow-style carousel.
 * Center card is prominent; neighbours peek from behind at reduced scale.
 * Touch-swipe on mobile, arrow buttons + keyboard on all devices.
 * No external carousel dependency (safe for static export).
 *
 * Usage:
 *   <ElfiaGallery
 *     items={[
 *       { src: "/images/elfia/everyday-taupe.jpg", alt: "ELFIA Everyday Shawl — Taupe" },
 *       ...
 *     ]}
 *   />
 */

export type GalleryItem = {
  src: string;
  alt: string;
  caption?: string;
};

export default function ElfiaGallery({ items }: { items: GalleryItem[] }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  const count = items.length;
  const go = useCallback(
    (dir: number) => setActive((i) => (i + dir + count) % count),
    [count]
  );

  // Keyboard support when the gallery has focus
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    if (!e.touches[0]) return;
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || !e.touches[0]) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (Math.abs(touchDeltaX.current) > 48) go(touchDeltaX.current < 0 ? 1 : -1);
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  // Preload neighbours of the active slide
  useEffect(() => {
    [active - 1, active + 1].forEach((i) => {
      const item = items[(i + count) % count];
      if (item) {
        const img = new window.Image();
        img.src = item.src;
      }
    });
  }, [active, count, items]);

  return (
    <div
      className="relative select-none"
      role="region"
      aria-roledescription="carousel"
      aria-label="ELFIA product gallery"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Stage */}
      <div
        className="relative mx-auto h-[420px] w-full max-w-5xl overflow-hidden sm:h-[480px]"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {items.map((item, i) => {
          // Signed shortest distance from the active card (wraps around)
          let offset = i - active;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;

          const abs = Math.abs(offset);
          const visible = abs <= 2;

          return (
            <figure
              key={item.src}
              aria-hidden={offset !== 0}
              className="absolute left-1/2 top-1/2 w-[72%] max-w-[320px] transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none sm:w-[46%] sm:max-w-[340px]"
              style={{
                transform: `translate(-50%, -50%) translateX(${offset * 62}%) scale(${
                  1 - abs * 0.14
                })`,
                zIndex: 10 - abs,
                opacity: visible ? 1 - abs * 0.25 : 0,
                pointerEvents: offset === 0 ? "auto" : "none",
              }}
            >
              <div className="overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-24px_rgba(26,41,70,0.45)] ring-1 ring-black/5">
                <div className="relative aspect-[3/4]">
                  <Image
                    src={item.src}
                    alt={item.alt}
                    fill
                    sizes="(max-width: 640px) 72vw, 340px"
                    className="object-cover"
                    priority={offset === 0}
                  />
                </div>
              </div>
              {item.caption && offset === 0 && (
                <figcaption className="mt-4 text-center text-sm font-medium text-[#1A2946]">
                  {item.caption}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous product"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#1A2946]/25 text-[#1A2946] transition hover:border-[#1A2946] hover:bg-[#1A2946] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A2946]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Position dots — small, tap-friendly */}
        <div className="flex items-center gap-2" aria-hidden="true">
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "w-5 bg-[#C9A24B]" : "w-1.5 bg-[#1A2946]/20"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next product"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#1A2946]/25 text-[#1A2946] transition hover:border-[#1A2946] hover:bg-[#1A2946] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A2946]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Screen-reader status */}
      <p className="sr-only" aria-live="polite">
        Showing item {active + 1} of {count}: {items[active]?.alt}
      </p>
    </div>
  );
}
