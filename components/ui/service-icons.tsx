import type { ComponentProps } from "react";

/**
 * Service icons (v1.2.16) — one professional line-icon family.
 *
 * Design rules, applied to all six so they read as a matched set:
 *  - 24px grid, 1.5px stroke, round caps/joins, no fills except deliberate dots
 *  - symmetric or optically centred within the 24px box
 *  - geometric and unambiguous: nothing that resembles a glyph or emoji
 *    (the previous "target + diagonal arrow" read as a ♂ symbol — replaced
 *    with concentric rings)
 *
 * Rendered gold on the navy brand chip, matching the AZ ONE identity.
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

/** Live host service — studio microphone */
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

/** Live commerce management — session dashboard, "you watch the numbers" */
export function IconLiveCommerce(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.75" y="4" width="18.5" height="13" rx="2" />
      <path d="M7.5 13.25v-2.5" />
      <path d="M11 13.25V8.5" />
      <path d="M14.5 13.25v-3.75" />
      <path d="M18 13.25V7" />
      <path d="M12 17v3.25" />
      <path d="M9 20.25h6" />
    </Svg>
  );
}

/** TikTok strategy — concentric target (positioning), symmetric and glyph-free */
export function IconStrategy(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <circle cx="12" cy="12" r="4.75" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Creative design — pen nib */
export function IconDesign(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.75 17.6 6l-1.45 7.9L12 19.6l-4.15-5.7L6.4 6 12 2.75Z" />
      <circle cx="12" cy="10.4" r="1.6" />
      <path d="M12 12v7.6" />
    </Svg>
  );
}

/** Video editing & content creation — clapperboard */
export function IconVideo(props: IconProps) {
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

/** Business consultation — conversation */
export function IconConsult(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.75 12.25a8 8 0 0 1-11.6 7.15l-5.15 1.6 1.6-5.15A8 8 0 1 1 20.75 12.25Z" />
      <path d="M9 12.25h.01" />
      <path d="M12 12.25h.01" />
      <path d="M15 12.25h.01" />
    </Svg>
  );
}
