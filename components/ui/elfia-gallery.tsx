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
}: {
  products: readonly ElfiaProduct[];
}) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  const count = products.length;
  const go = useCallback(
    (dir: number) => setActive((i) => (i + dir + count) % count),
    [count],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };

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
      className="relative select-none"
      role="region"
      aria-roledescription="carousel"
      aria-label="ELFIA product gallery"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div
        className="relative h-[420px] w-full overflow-hidden sm:h-[480px]"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
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
              className="absolute top-1/2 left-1/2 w-[72%] max-w-[300px] transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none sm:w-[52%] sm:max-w-[320px]"
              style={{
                transform: `translate(-50%, -50%) translateX(${offset * 62}%) scale(${1 - abs * 0.14})`,
                zIndex: 10 - abs,
                opacity: visible ? 1 - abs * 0.25 : 0,
                pointerEvents: isCenter ? "auto" : "none",
              }}
            >
              {isCenter ? (
                <Link
                  href={`/products/${product.slug}`}
                  className="group block"
                  tabIndex={-1}
                >
                  {card}
                  <figcaption className="mt-4 text-center text-base font-medium text-white group-hover:underline">
                    {product.name}
                  </figcaption>
                </Link>
              ) : (
                card
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

        <div className="flex items-center gap-2" aria-hidden="true">
          {products.map((p, i) => (
            <span
              key={p.slug}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "bg-gold w-5" : "w-1.5 bg-white/25"
              }`}
            />
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

      <p className="sr-only" aria-live="polite">
        Showing item {active + 1} of {count}: {products[active]?.name}
      </p>
    </div>
  );
}
