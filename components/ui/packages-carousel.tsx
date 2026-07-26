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

  const count = packages.length;

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = el.scrollWidth / count;
    setActive(Math.min(count - 1, Math.round(el.scrollLeft / step)));
  }, [count]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

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

  const goTo = (index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(count - 1, index));
    const step = el.scrollWidth / count;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: clamped * step, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-grab snap-x snap-mandatory gap-6 overflow-x-auto pb-2 select-none active:cursor-grabbing [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Package tiers"
      >
        {packages.map((tier) => (
          <article
            key={tier.name}
            className={`flex shrink-0 basis-[86%] snap-center flex-col rounded-xl border p-6 sm:basis-[48%] lg:basis-[31.5%] ${
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

      <div className="mt-6 flex items-center gap-2">
        {packages.map((tier, i) => (
          <button
            key={tier.name}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${tier.name}`}
            aria-current={i === active}
            className="group flex h-6 w-4 items-center justify-center"
          >
            <span
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active
                  ? "bg-gold-deep w-5"
                  : "bg-border w-1.5 group-hover:bg-muted-foreground/50"
              }`}
            />
          </button>
        ))}
        <span className="text-muted-foreground ml-2 text-xs">
          Swipe or drag to see all {packages.length}
        </span>
      </div>
    </div>
  );
}
