"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ProductGallery (v1.2.22) — main image plus a thumbnail strip.
 *
 * The classic e-commerce pattern, and the right one here: shoppers want one
 * large, uncropped view of the fabric with quick access to the other angles.
 * The previous 2-column grid showed every shot at once, so none of them was
 * large enough to judge drape.
 *
 * Swipe on the main image, click/keyboard on the thumbnails.
 */
export function ProductGallery({
  images,
  alt,
}: {
  images: readonly string[];
  alt: string;
}) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  const count = images.length;
  const go = useCallback(
    (dir: number) => setActive((i) => (i + dir + count) % count),
    [count],
  );

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

  // Preload the neighbouring angle so switching feels instant
  useEffect(() => {
    const next = images[(active + 1) % count];
    if (next) {
      const img = new window.Image();
      img.src = next;
    }
  }, [active, count, images]);

  if (count === 0) return null;

  return (
    <div className="mx-auto w-full max-w-[380px] lg:max-w-[440px]">
      <div
        className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative aspect-[4/5] max-h-[62vh]">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={i === 0 ? alt : `${alt} — view ${i + 1}`}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none ${
                i === active ? "opacity-100" : "opacity-0"
              }`}
              loading={i === 0 ? "eager" : "lazy"}
              aria-hidden={i !== active}
            />
          ))}
        </div>

        {count > 1 && (
          <span className="absolute right-3 bottom-3 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white/90">
            {active + 1} / {count}
          </span>
        )}
      </div>

      {count > 1 && (
        <ul className="mt-3 grid grid-cols-4 gap-2.5">
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`View image ${i + 1} of ${count}`}
                aria-current={i === active}
                className={`block w-full overflow-hidden rounded-lg border transition-colors ${
                  i === active
                    ? "border-gold"
                    : "border-white/10 hover:border-white/40"
                }`}
              >
                <span className="relative block aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className={`h-full w-full object-cover transition-opacity ${
                      i === active ? "opacity-100" : "opacity-70 hover:opacity-100"
                    }`}
                    loading="lazy"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
