"use client";

/* v1.8.0 — Avatar (UI-REDESIGN-PLAN.md Phase 0).
   Photo when we have one, colored initials when we don't — navy disc, gold
   letters, both from tokens so dark mode is free. One component so the
   schedule grid, roster lists and tables can't drift into three initials
   styles the way cards once drifted into three paddings. */

import { useState } from "react";

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ name, src, size = "md", dot, className = "" }: {
  name: string;
  /** Photo URL (e.g. /api/v1/media/file/<key>). Initials shown until it loads
      and if it fails — a broken staff photo must never break a roster row. */
  src?: string | null;
  size?: keyof typeof SIZES;
  /** Presence/status dot: green = active/online-style accent. */
  dot?: "success" | "warning" | "muted";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;
  const dotCls =
    dot === "success" ? "bg-success" : dot === "warning" ? "bg-warning" : dot === "muted" ? "bg-muted-foreground/50" : "";
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        className={`${SIZES[size]} bg-brand text-gold inline-flex items-center justify-center overflow-hidden rounded-full font-semibold select-none`}
        aria-hidden={showImg ? undefined : true}
      >
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2-served photos; next/image needs a loader the static export doesn't have
          <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          initialsOf(name)
        )}
      </span>
      {dot && (
        <span className={`ring-card absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ${dotCls}`} />
      )}
    </span>
  );
}
