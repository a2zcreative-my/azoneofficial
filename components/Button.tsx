import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Button — single source of truth for button sizing so widths stay consistent.
 *
 * Rules enforced here:
 *  - Every button has min-w-[180px] on ≥sm screens, so side-by-side CTAs match.
 *  - On mobile, buttons in a stacked group go full-width (w-full sm:w-auto).
 *  - Same height (h-12), padding, and radius everywhere.
 *
 * Replace ad-hoc <a>/<button> styling across Home, Services, ELFIA, and Contact
 * with this component. Two variants only: primary (navy) and outline.
 */

type Props = {
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "outline";
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
};

const base =
  "inline-flex h-12 w-full items-center justify-center rounded-full px-7 text-sm font-semibold tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A2946] sm:w-auto sm:min-w-[180px]";

const variants = {
  primary: "bg-[#1A2946] text-white hover:bg-[#23345C]",
  outline:
    "border border-[#1A2946]/30 text-[#1A2946] hover:border-[#1A2946] hover:bg-[#1A2946]/5",
};

export default function Button({
  href,
  onClick,
  variant = "primary",
  children,
  className = "",
  type = "button",
}: Props) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
