"use client";

import { usePathname } from "next/navigation";

import { useEffect, useState } from "react";

/**
 * ScrollToTop (v1.2.14) — floating "back to top" control.
 *
 * Visibility rules:
 *  - hidden at the top of the page (appears after ~500px of scroll)
 *  - hidden while the footer is on screen, so it never covers footer links
 *  - reappears as soon as the footer scrolls back out of view
 *
 * Footer detection uses IntersectionObserver against #site-footer.
 */
export function ScrollToTop() {
  const pathname = usePathname() ?? "";
  const appView = pathname.startsWith("/portal") || pathname.startsWith("/admin") || pathname.startsWith("/account");
  const [scrolled, setScrolled] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry?.isIntersecting ?? false),
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const visible = scrolled && !footerVisible;

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  if (appView) return null;

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={`bg-brand hover:bg-gold fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all duration-300 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none sm:right-8 sm:bottom-8 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 19V5M5 12l7-7 7 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
