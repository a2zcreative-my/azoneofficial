"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const KEY = "azo:scroll";

function readMap(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage disabled — scroll memory is a nicety, not load-bearing */
  }
}

/**
 * ScrollMemory (v1.2.23) — restores scroll position on back/forward.
 *
 * Why this exists: going /products → a product → Back landed at the top of
 * /products instead of the card you tapped. The App Router restores scroll
 * from its own cache, but it does so before the returning page has finished
 * laying out, so the target offset is often taller than the document is at
 * that instant and the scroll silently clamps to 0.
 *
 * This records the offset per path and, on a popstate navigation only, retries
 * across animation frames until the document is actually tall enough to honour
 * it. Forward navigation still starts at the top, and a reload still starts at
 * the top (handled by the inline script in app/layout.tsx).
 */
function isBackForwardLoad(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type === "back_forward";
  } catch {
    return false;
  }
}

export function ScrollMemory() {
  const pathname = usePathname();
  // True for in-app Back/Forward, and for a full document load that arrived
  // via Back/Forward (e.g. Back after refreshing a product page).
  const isPop = useRef(typeof window !== "undefined" && isBackForwardLoad());

  useEffect(() => {
    const onPop = () => {
      isPop.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Record where the visitor is on this path
  useEffect(() => {
    let timer = 0;
    const save = () => {
      const map = readMap();
      map[pathname] = window.scrollY;
      writeMap(map);
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 120);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, [pathname]);

  // Restore it, but only when arriving via Back/Forward
  useEffect(() => {
    if (!isPop.current) return;
    isPop.current = false;

    const target = readMap()[pathname] ?? 0;
    if (target <= 0) {
      document.documentElement.removeAttribute("data-scroll-reset");
      if ("scrollRestoration" in history) history.scrollRestoration = "auto";
      return;
    }

    const root = document.documentElement;
    root.setAttribute("data-scroll-reset", "1"); // suppress smooth scrolling

    let frames = 0;
    const attempt = () => {
      const max = root.scrollHeight - window.innerHeight;
      // Wait for layout (images, fonts) to make the page tall enough.
      // ~90 frames is roughly 1.5s — long enough for a slow connection,
      // short enough that a genuinely short page does not hang here.
      if (max >= target || frames > 90) {
        window.scrollTo(0, target);
        root.removeAttribute("data-scroll-reset");
        // Hand control back so ordinary navigation behaves normally again
        if ("scrollRestoration" in history) history.scrollRestoration = "auto";
        return;
      }
      frames += 1;
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [pathname]);

  return null;
}
