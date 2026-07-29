"use client";

import { useEffect, useState } from "react";

/**
 * WhatsAppFab (v1.2.18) — floating WhatsApp button.
 *
 * Malaysian buyers convert on WhatsApp, so the fastest contact route is always
 * one tap away. Sits above the back-to-top button in the same corner stack and
 * hides over the footer, where the contact links already appear.
 */
export function WhatsAppFab({ href }: { href: string }) {
  const [footerVisible, setFooterVisible] = useState(false);

  useEffect(() => {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry.isIntersecting),
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      tabIndex={footerVisible ? -1 : 0}
      aria-hidden={footerVisible}
      className={`fixed right-5 bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+3.75rem)] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-all duration-300 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] motion-reduce:transition-none sm:right-8 sm:bottom-[calc(2rem+3.75rem)] ${
        footerVisible
          ? "pointer-events-none translate-y-3 opacity-0"
          : "translate-y-0 opacity-100"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35Z" />
        <path d="M12.04 2.5c-5.24 0-9.5 4.26-9.5 9.5 0 1.67.44 3.3 1.27 4.74L2.5 21.5l4.9-1.28a9.46 9.46 0 0 0 4.64 1.2h.01c5.23 0 9.49-4.26 9.49-9.5 0-2.54-.99-4.92-2.78-6.71a9.42 9.42 0 0 0-6.72-2.71Zm0 17.4h-.01a7.9 7.9 0 0 1-4.02-1.1l-.29-.17-2.91.76.78-2.84-.19-.29a7.86 7.86 0 0 1-1.21-4.2c0-4.36 3.55-7.9 7.91-7.9 2.11 0 4.09.82 5.58 2.32a7.84 7.84 0 0 1 2.31 5.59c0 4.36-3.55 7.9-7.9 7.9Z" />
      </svg>
    </a>
  );
}
