import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionProps {
  id: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  dark?: boolean;
  children: ReactNode;
  className?: string;
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  dark = false,
  children,
  className,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 px-6 py-20 sm:py-28",
        dark ? "bg-brand text-white" : "bg-background text-foreground",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl">
        {(eyebrow || title || intro) && (
          <header className="mb-12 max-w-2xl sm:mb-16">
            {eyebrow && (
              <p className="text-gold mb-3 text-xs font-medium tracking-[0.3em] uppercase">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {title}
              </h2>
            )}
            {intro && (
              <p
                className={cn(
                  "mt-4 text-base leading-relaxed",
                  dark ? "text-white/70" : "text-muted-foreground",
                )}
              >
                {intro}
              </p>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
