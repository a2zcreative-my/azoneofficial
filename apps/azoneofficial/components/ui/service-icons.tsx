import type { ComponentProps } from "react";

/**
 * Service icons — one family for the seven live commerce services.
 * 24px grid, 1.5px stroke, round caps, optically centred, purely geometric:
 * nothing that resembles a glyph or emoji.
 */

type IconProps = ComponentProps<"svg">;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** TikTok Live — phone in portrait, broadcasting */
export function IconTikTokLive(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.5" />
      <path d="M10.75 18.5h2.5" />
      <path d="M10.4 9.4v3.7a1.85 1.85 0 1 1-1.85-1.85" />
      <path d="M12.25 6.75c.2 1.2 1.1 2.1 2.35 2.3" />
    </Svg>
  );
}

/** Shopee Live — shopping bag with a live dot */
export function IconShopeeLive(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7.75h15l-1.1 12a1.6 1.6 0 0 1-1.6 1.5H7.2a1.6 1.6 0 0 1-1.6-1.5Z" />
      <path d="M9 7.75V6a3 3 0 0 1 6 0v1.75" />
      <circle cx="12" cy="14" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Live commerce strategy — concentric target */
export function IconStrategy(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <circle cx="12" cy="12" r="4.75" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Live hosts — studio microphone */
export function IconLiveHost(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2.75" width="6" height="11" rx="3" />
      <path d="M5.75 11v.5a6.25 6.25 0 0 0 12.5 0V11" />
      <path d="M12 18v3.25" />
      <path d="M8.75 21.25h6.5" />
    </Svg>
  );
}

/** Live operations — control sliders */
export function IconOperations(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5v6.25M6 14.25v6.25" />
      <path d="M12 3.5v3.25M12 11.25v9.25" />
      <path d="M18 3.5v9.25M18 17.25v3.25" />
      <circle cx="6" cy="12" r="2.25" />
      <circle cx="12" cy="9" r="2.25" />
      <circle cx="18" cy="15" r="2.25" />
    </Svg>
  );
}

/** Creative content — clapperboard */
export function IconCreative(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.75" y="7.25" width="18.5" height="13" rx="2" />
      <path d="M2.75 12h18.5" />
      <path d="m7 7.25 2.25 4.75" />
      <path d="m12 7.25 2.25 4.75" />
      <path d="m17 7.25 2.25 4.75" />
    </Svg>
  );
}

/** Performance marketing — growth curve with a rising arrow */
export function IconPerformance(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.25 20.25h17.5" />
      <path d="M6 16.5c2.5 0 4-2.75 6-5s4-4.5 6.75-4.5" />
      <path d="M15.5 6.75h3.25V10" />
      <path d="M6 20.25V17M12 20.25v-6.5M18 20.25v-9" />
    </Svg>
  );
}
