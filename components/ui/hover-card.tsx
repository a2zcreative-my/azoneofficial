"use client";

/* v1.8.0 — HoverCard (UI-REDESIGN-PLAN.md Phase 0).
   The reference schedule's dark detail card that appears over a calendar
   block. Hover on desktop, tap-to-toggle on touch (a hover-only detail is
   invisible on every phone in the company). The parent positions it; this
   only supplies the surface + a11y wiring. */

import { useState, type ReactNode } from "react";

export function HoverCard({ trigger, children, className = "", side = "top" }: {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const pos = side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="block w-full cursor-pointer text-left outline-none"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        {trigger}
      </button>
      {open && (
        <span role="tooltip"
          className={`bg-brand shadow-soft absolute left-1/2 z-30 w-56 -translate-x-1/2 rounded-xl p-3 text-white ${pos}`}>
          {children}
        </span>
      )}
    </span>
  );
}
