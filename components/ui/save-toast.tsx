"use client";

/**
 * v1.4.87 — shared save-confirmation toast, same animation family as the
 * clock-in PunchToast: centred card, ring draw, tick (success) or "i"
 * (notice, e.g. "No changes"), auto-fades. One component + one hook so every
 * tab's Save can confirm itself identically.
 */

import { useCallback, useRef, useState } from "react";
import { toastCard } from "@/lib/ui-styles";

/* v1.181.4 - HOW LONG A TOAST STAYS. "Saved ✓" reads in a glance, so 2.6 s
   is right for it. A notice that explains a failure - "the receipt did NOT
   upload; the server said...; use Attach receipt to try again" - is thirty
   words, and it vanished before the CEO had read half of it (Claims,
   23-09-2026). A notice now stays for the time its words take to read,
   between the old 2.6 s and 9 s. */
export function toastHoldMs(title: string, sub = "", variant: "success" | "notice" = "success"): number {
  if (variant !== "notice") return 2600;
  return Math.min(9000, Math.max(2600, 1200 + (title.length + sub.length) * 45));
}

export function SaveToast({ title, sub = "", variant = "success", holdMs = 2600 }: { title: string; sub?: string; variant?: "success" | "notice"; holdMs?: number }) {
  /* v1.124.0 — was a hard-coded navy/amber pair. The ring is app UI, not
     paper, so it follows the theme: --primary flips light on dark cards,
     --warning is the audited amber that stays separable from danger. */
  const colour = variant === "success" ? "var(--primary)" : "var(--warning)";
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <style>{`
        @keyframes save-pop { 0% { opacity: 0; transform: scale(.82) translateY(8px); } 60% { opacity: 1; transform: scale(1.03); } 100% { transform: scale(1); } }
        @keyframes save-ring { from { stroke-dashoffset: 151; } to { stroke-dashoffset: 0; } }
        @keyframes save-check { from { stroke-dashoffset: 36; } to { stroke-dashoffset: 0; } }
        @keyframes save-fade { to { opacity: 0; } }
      `}</style>
      <div
        className={toastCard}
        style={{ animation: "save-pop .45s cubic-bezier(.2,.9,.3,1.2) both, save-fade .4s ease .2s forwards", animationDelay: `0s, ${(holdMs - 400) / 1000}s` }}
        role="status"
        aria-live="polite"
      >
        <svg viewBox="0 0 52 52" className="mx-auto h-14 w-14" aria-hidden="true">
          <circle cx="26" cy="26" r="24" fill="none" stroke={colour} strokeWidth="2.5"
            strokeDasharray="151" style={{ animation: "save-ring .6s ease-out .1s both" }} />
          {variant === "success" ? (
            <path d="M15 27l7.5 7.5L37 20" fill="none" stroke={colour} strokeWidth="3.5"
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray="36"
              style={{ animation: "save-check .35s ease-out .55s both" }} />
          ) : (
            <g style={{ animation: "save-check .35s ease-out .55s both" }}>
              <path d="M26 16v12" fill="none" stroke={colour} strokeWidth="3.5" strokeLinecap="round" />
              <circle cx="26" cy="35" r="2.2" fill={colour} />
            </g>
          )}
        </svg>
        <p className="mt-2 text-base font-semibold">{title}</p>
        {sub && <p className="text-muted-foreground mt-0.5 text-sm">{sub}</p>}
      </div>
    </div>
  );
}

export function useSaveToast() {
  const [toast, setToast] = useState<{ title: string; sub?: string; variant?: "success" | "notice"; holdMs: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((title: string, sub = "", variant: "success" | "notice" = "success") => {
    window.clearTimeout(timer.current);
    setToast(null);
    // Re-mount on next frame so back-to-back saves replay the animation.
    window.requestAnimationFrame(() => {
      const holdMs = toastHoldMs(title, sub, variant);
      setToast({ title, sub, variant, holdMs });
      timer.current = window.setTimeout(() => setToast(null), holdMs);
    });
  }, []);
  const node = toast ? <SaveToast title={toast.title} sub={toast.sub} variant={toast.variant} holdMs={toast.holdMs} /> : null;
  return { show, node };
}
