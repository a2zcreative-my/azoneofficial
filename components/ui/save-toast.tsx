"use client";

/**
 * v1.4.87 — shared save-confirmation toast, same animation family as the
 * clock-in PunchToast: centred card, ring draw, tick (success) or "i"
 * (notice, e.g. "No changes"), auto-fades. One component + one hook so every
 * tab's Save can confirm itself identically.
 */

import { useCallback, useRef, useState } from "react";

export function SaveToast({ title, sub = "", variant = "success" }: { title: string; sub?: string; variant?: "success" | "notice" }) {
  const colour = variant === "success" ? "#1a2946" : "#d97706";
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <style>{`
        @keyframes save-pop { 0% { opacity: 0; transform: scale(.82) translateY(8px); } 60% { opacity: 1; transform: scale(1.03); } 100% { transform: scale(1); } }
        @keyframes save-ring { from { stroke-dashoffset: 151; } to { stroke-dashoffset: 0; } }
        @keyframes save-check { from { stroke-dashoffset: 36; } to { stroke-dashoffset: 0; } }
        @keyframes save-fade { to { opacity: 0; } }
      `}</style>
      <div
        className="bg-card border-border rounded-2xl border px-8 py-6 text-center shadow-2xl"
        style={{ animation: "save-pop .45s cubic-bezier(.2,.9,.3,1.2) both, save-fade .4s ease .2s forwards", animationDelay: "0s, 2.2s" }}
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
  const [toast, setToast] = useState<{ title: string; sub?: string; variant?: "success" | "notice" } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((title: string, sub = "", variant: "success" | "notice" = "success") => {
    window.clearTimeout(timer.current);
    setToast(null);
    // Re-mount on next frame so back-to-back saves replay the animation.
    window.requestAnimationFrame(() => {
      setToast({ title, sub, variant });
      timer.current = window.setTimeout(() => setToast(null), 2600);
    });
  }, []);
  const node = toast ? <SaveToast title={toast.title} sub={toast.sub} variant={toast.variant} /> : null;
  return { show, node };
}
