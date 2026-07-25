import type { ComponentProps } from "react";

/**
 * Service icons (v1.2.6) — one professional family for the six services.
 * All on a 24px grid, 1.6px stroke, rounded caps, so they read as one set.
 * Drop-in compatible with the lucide usage in Services (className prop).
 */

type IconProps = ComponentProps<"svg">;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Live host service — broadcast microphone */
export function IconLiveHost(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M8.5 21h7" />
    </Svg>
  );
}

/** Live commerce management — live dashboard */
export function IconLiveCommerce(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M7 13.5v-3M12 13.5v-5M17 13.5v-7" />
      <path d="M9 21h6M12 17v4" />
    </Svg>
  );
}

/** TikTok strategy — target with growth arrow */
export function IconStrategy(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="13" r="7" />
      <circle cx="11" cy="13" r="3" />
      <path d="M15.5 8.5L21 3M21 3h-4.5M21 3v4.5" />
    </Svg>
  );
}

/** Creative design — pen nib */
export function IconDesign(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l6 3.5-1.5 8.5-4.5 6-4.5-6L6 6.5 12 3z" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 13.6V21" />
    </Svg>
  );
}

/** Video editing & content creation — clapperboard with play */
export function IconVideo(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18M7 7l2.5 4M12 7l2.5 4M17 7l2.5 4" />
      <path d="M10.5 14.5l3.5 2-3.5 2v-4z" />
    </Svg>
  );
}

/** Business consultation — briefcase with upward trend */
export function IconConsult(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M7 15.5l3-2.5 2.5 2 4.5-4" />
    </Svg>
  );
}
