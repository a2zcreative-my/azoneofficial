import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

interface PageShellProps {
  eyebrow: string;
  title: string;
  updated?: string;
  children: ReactNode;
}

export function PageShell({ eyebrow, title, updated, children }: PageShellProps) {
  return (
    <>
      <Navbar />
      <main className="px-6 pt-28 pb-16 sm:pt-32 sm:pb-24">
        <article className="mx-auto w-full max-w-3xl">
          <header className="mb-10">
            <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {updated && (
              <p className="text-muted-foreground mt-3 text-sm">
                Last updated: {updated}
              </p>
            )}
          </header>
          <div className="space-y-8 text-base leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:text-muted-foreground [&_li]:text-muted-foreground">
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
