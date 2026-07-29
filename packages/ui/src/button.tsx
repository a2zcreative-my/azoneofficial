import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Button (v1.2.6) — single source of truth for CTA sizing.
 * Fixes the width/shape drift across pages (contact page was rounded-full,
 * everywhere else rounded-lg; widths varied by label length).
 *
 * Rules: h-12, rounded-lg, px-8, min-w-[180px] on ≥sm so paired CTAs align;
 * full-width when stacked on mobile.
 */

type Props = {
  /** Omit to render a real <button> (e.g. form submit) instead of a link. */
  href?: string;
  external?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "gold" | "outline" | "outlineLight";
  children: ReactNode;
  className?: string;
};

const base =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-center text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto sm:min-w-[180px] sm:px-8";

const variants = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/85 focus-visible:outline-primary",
  gold: "bg-gold hover:bg-gold/85 text-black focus-visible:outline-gold",
  outline:
    "border border-border hover:bg-secondary focus-visible:outline-primary",
  outlineLight:
    "border border-white/20 text-white hover:bg-white/10 focus-visible:outline-white",
};

export function Button({
  href,
  external = false,
  onClick,
  disabled,
  type = "button",
  variant = "primary",
  children,
  className = "",
}: Props) {
  const cls = `${base} ${variants[variant]} ${className}`;

  if (!href) {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`${cls} disabled:opacity-50`}
      >
        {children}
      </button>
    );
  }

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
