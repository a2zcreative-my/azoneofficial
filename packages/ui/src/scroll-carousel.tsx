"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * ScrollCarousel — horizontal scroll-snap track with drag support and a
 * progress bar. Layout primitive only: callers supply the cards as children,
 * so it works for package tiers, collections, case studies, or anything else.
 *
 * Deliberately no autoplay — the content that uses this is text-heavy and
 * moving it under a reader is hostile. Use CoverflowGallery for imagery.
 */
export function ScrollCarousel({
  children,
  label,
  /** Tailwind basis classes controlling how many cards show per breakpoint. */
  itemClassName = "basis-[86%] sm:basis-[48%] lg:basis-[30%]",
}: {
  children: ReactNode[];
  label: string;
  itemClassName?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState({ ratio: 1, offset: 0 });
  const count = children.length;

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ratio = el.clientWidth / el.scrollWidth;
    const scrollable = el.scrollWidth - el.clientWidth;
    setProgress({
      ratio: Math.min(1, ratio),
      offset: scrollable > 0 ? el.scrollLeft / scrollable : 0,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [onScroll]);

  // Pointer drag — a mouse cannot swipe, and this track has no arrows
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el || !drag.current.active) return;
    el.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX);
  };
  const endDrag = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    drag.current.active = false;
  };

  const thumbWidth = Math.max(12, progress.ratio * 100);
  const thumbOffset = progress.offset * ((100 - thumbWidth) / thumbWidth) * 100;
  const atEnd = progress.offset >= 0.99;

  return (
    <div className="relative">
      {/* Right-edge fade: shows the track continues, without instruction text */}
      <div
        aria-hidden="true"
        className={`from-background pointer-events-none absolute top-0 right-0 z-10 h-full w-12 bg-gradient-to-l to-transparent transition-opacity duration-300 ${
          atEnd ? "opacity-0" : "opacity-100"
        }`}
      />

      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="group"
        tabIndex={0}
        aria-label={`${label} — scroll horizontally to see all ${count}`}
        className="flex cursor-grab snap-x snap-mandatory gap-6 overflow-x-auto pb-2 select-none active:cursor-grabbing [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children.map((child, i) => (
          <div key={i} className={`flex shrink-0 snap-center ${itemClassName}`}>
            {child}
          </div>
        ))}
      </div>

      <div
        className="bg-border relative mt-6 h-1 w-full overflow-hidden rounded-full"
        role="presentation"
      >
        <span
          className="bg-gold-deep absolute top-0 left-0 h-full rounded-full transition-[width,transform] duration-200 ease-out"
          style={{
            width: `${thumbWidth}%`,
            transform: `translateX(${thumbOffset}%)`,
          }}
        />
      </div>
    </div>
  );
}
