import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { cn } from "@/lib/utils";

interface PageShellProps {
  eyebrow: string;
  title: string;
  /** Optional lead paragraph under the title. */
  intro?: string;
  updated?: string;
  /** Navy background variant for showcase-style pages. */
  dark?: boolean;
  children: ReactNode;
}

/**
 * PageShell (v1.2.13) — the single page frame for every inner page.
 *
 * Standardised on the former /products frame so all pages share one rhythm:
 *   main pt-16 (clears the fixed navbar)
 *   -> mx-auto max-w-6xl px-6 py-16 sm:py-24
 *   -> header (eyebrow / h1 / intro) -> content
 *
 * The frame is wide and identical everywhere; running text inside is capped at
 * max-w-3xl so line length stays readable — wide frame, readable measure.
 */
export function PageShell({
  eyebrow,
  title,
  intro,
  updated,
  dark = false,
  children,
}: PageShellProps) {
  return (
    <>
      <Navbar />
      <main
        className={cn(
          "pt-16",
          dark ? "bg-brand text-white" : "bg-background text-foreground",
        )}
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
          <header className="max-w-3xl">
            <p
              className={cn(
                "mb-3 text-xs font-medium tracking-[0.3em] uppercase",
                dark ? "text-gold" : "text-gold-deep",
              )}
            >
              {eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {title}
            </h1>
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
            {updated && (
              <p
                className={cn(
                  "mt-3 text-sm",
                  dark ? "text-white/60" : "text-muted-foreground",
                )}
              >
                Last updated: {updated}
              </p>
            )}
          </header>

          <div
            className={cn(
              "mt-12 space-y-12 text-base leading-relaxed sm:mt-16",
              "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
              // Keep running text readable, but never constrain layout
              // lists (card grids) — that produced dead space on /about.
              "[&_section>p]:max-w-3xl",
              "[&_section>ul:not([class*=grid]):not([class*=flex])]:max-w-3xl",
              dark
                ? "[&_li]:text-white/70 [&_p]:text-white/70"
                : "[&_li]:text-muted-foreground [&_p]:text-muted-foreground",
            )}
          >
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
