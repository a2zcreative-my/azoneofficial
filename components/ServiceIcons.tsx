import type { ReactNode } from "react";

/**
 * ServiceIcons — one consistent, professional icon set for the six services.
 * All icons: 24px grid, 1.6px stroke, rounded caps — so they read as one family.
 * Chip style: navy square, gold icon (brand colours, replaces the beige chips).
 *
 * Usage in the Services section:
 *   <ServiceIcon name="liveHost" />
 */

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

const paths: Record<string, ReactNode> = {
  // Live host service — broadcast microphone
  liveHost: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" {...stroke} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" {...stroke} />
      <path d="M12 17.5V21M8.5 21h7" {...stroke} />
    </>
  ),
  // Live commerce management — live dashboard (monitor + rising bars)
  liveCommerce: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" {...stroke} />
      <path d="M7 13.5v-3M12 13.5v-5M17 13.5v-7" {...stroke} />
      <path d="M9 21h6M12 17v4" {...stroke} />
    </>
  ),
  // TikTok strategy — target with growth arrow
  strategy: (
    <>
      <circle cx="11" cy="13" r="7" {...stroke} />
      <circle cx="11" cy="13" r="3" {...stroke} />
      <path d="M15.5 8.5L21 3M21 3h-4.5M21 3v4.5" {...stroke} />
    </>
  ),
  // Creative design — pen nib
  design: (
    <>
      <path d="M12 3l6 3.5-1.5 8.5-4.5 6-4.5-6L6 6.5 12 3z" {...stroke} />
      <circle cx="12" cy="12" r="1.6" {...stroke} />
      <path d="M12 13.6V21" {...stroke} />
    </>
  ),
  // Video editing & content creation — clapperboard
  video: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" {...stroke} />
      <path d="M3 11h18M7 7l2.5 4M12 7l2.5 4M17 7l2.5 4" {...stroke} />
      <path d="M10.5 14.5l3.5 2-3.5 2v-4z" {...stroke} />
    </>
  ),
  // Business consultation — briefcase with upward line
  consult: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" {...stroke} />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" {...stroke} />
      <path d="M7 15.5l3-2.5 2.5 2 4.5-4" {...stroke} />
    </>
  ),
};

export type ServiceIconName = keyof typeof paths;

export function ServiceIcon({ name }: { name: ServiceIconName }) {
  return (
    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1A2946] text-[#C9A24B]">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        {paths[name]}
      </svg>
    </span>
  );
}

/** Mapping for the existing six service cards */
export const serviceIconMap: Record<string, ServiceIconName> = {
  "Live host service": "liveHost",
  "Live commerce management": "liveCommerce",
  "TikTok strategy": "strategy",
  "Creative design": "design",
  "Video editing & content creation": "video",
  "Business consultation": "consult",
};
