"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PackageTier } from "@/types";

/**
 * PackagesCarousel (v1.2.21) — scroll-snap carousel for the package tiers.
 *
 * Uses native horizontal scroll + snap rather than the coverflow transform used
 * for ELFIA: these cards are text, so partial/scaled neighbours would hurt
 * readability. One card at a time on mobile, two on tablet, three on desktop —
 * so it stays a carousel (and stays compact) at every width.
 *
 * Deliberately NOT autoplaying: package details need reading time, and moving
 * text under someone mid-sentence is hostile.
 */
export function PackagesCarousel({
  packages,
}: {
  packages: readonly PackageTier[];
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState({ ratio: 1, offset: 0 });

  const count = packages.length;

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = el.scrollWidth / count;
    setActive(Math.min(count - 1, Math.round(el.scrollLeft / step)));

    // Visible fraction of the track, and how far along it we are
    const ratio = el.clientWidth / el.scrollWidth;
    const scrollable = el.scrollWidth - el.clientWidth;
    const offset = scrollable > 0 ? el.scrollLeft / scrollable : 0;
    setProgress({ ratio: Math.min(1, ratio), offset });
  }, [count]);

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

  const thumbWidth = Math.max(12, progress.ratio * 100);
  const thumbOffset = progress.offset * ((100 - thumbWidth) / thumbWidth) * 100;

  // Drag-to-scroll: without arrows, a mouse user needs some way to move the
  // track. Touch devices already scroll natively, so this is pointer-only.
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el || !drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.startScroll - dx;
  };

  const endDrag = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    drag.current.active = false;
  };

  const atEnd = active >= count - 1;

  return (
    <div className="relative">
      {/* Fades the right edge while more cards remain — a visual cue that the
          track continues, which reads better than an instruction sentence. */}
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
        className="flex cursor-grab snap-x snap-mandatory gap-6 overflow-x-auto pb-2 select-none active:cursor-grabbing [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        tabIndex={0}
        aria-label="Package tiers — scroll horizontally to see all"
      >
        {packages.map((tier) => (
          <article
            key={tier.name}
            className={`flex shrink-0 basis-[86%] snap-center flex-col rounded-xl border p-6 sm:basis-[48%] lg:basis-[30%] ${
              tier.featured
                ? "border-gold-deep/40 bg-secondary/40"
                : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold tracking-tight">
                {tier.name}
              </h3>
              {tier.featured && (
                <span className="bg-brand text-gold rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                  Most chosen
                </span>
              )}
            </div>
            <p className="text-gold-deep mt-2 text-sm font-medium">
              {tier.cadence}
            </p>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {tier.tagline}
            </p>
            <ul className="mt-5 grow space-y-2.5">
              {tier.features.map((feature) => (
                <li
                  key={feature}
                  className="text-muted-foreground flex items-start gap-2.5 text-sm leading-relaxed"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-gold-deep mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          </article>
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
