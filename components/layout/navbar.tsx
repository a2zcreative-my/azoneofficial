"use client";

import { Menu, X } from "lucide-react";

import { LangToggle } from "@/components/live/lang-runtime";
import Link from "next/link";
import { useState } from "react";

import { whatsappUrl } from "@/constants/content";
import { CTA_LABEL, NAV_ITEMS, SITE_CONFIG } from "@/constants/site";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-border/60 bg-background/80 fixed inset-x-0 top-0 z-50 border-b backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6"
      >
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex shrink-0 items-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* v1.33.0 — h-7 → h-9/h-10. The new mark is a STACKED lockup
              (A2Z over CREATIVE, 991×547); at 28px in a 64px bar the word
              CREATIVE rendered about 4px tall and read as a grey smudge. At
              40px it is legible and the bar still has 12px of breathing room
              top and bottom. The extra ~22px of width is affordable: BM — the
              tighter language — had 141px of slack at 1280 after v1.32.1
              (scratch/nav-fit-measure.mjs), and nav-fit-e2e re-checks it at
              eight widths in both languages. */}
          <img
            src="/logo.png"
            alt={SITE_CONFIG.name}
            className="h-9 w-auto sm:h-10"
          />
        </Link>

        {/* v1.32.1 — the desktop row appears at xl, not md.
            Measured (scratch/nav-fit-measure.mjs): in Bahasa Melayu the seven
            labels plus the toggle, Login and the CTA want 1067px, and the row
            is only 961–1057px wide between 1024 and 1120. That is why the CEO
            saw "Tentang Kami" printed through the logo and the CTA on two
            lines. Below xl the hamburger takes over — the language toggle
            stays outside it so a BM reader never has to open a menu to find
            their own language. whitespace-nowrap is the belt: a longer label
            in future overflows visibly rather than folding into its neighbour. */}
        <ul className="hidden items-center gap-6 xl:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="text-muted-foreground hover:text-foreground text-sm whitespace-nowrap transition-colors"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-4 xl:flex">
          <LangToggle />
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground text-sm whitespace-nowrap transition-colors"
          >
            Login
          </Link>
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium whitespace-nowrap transition-colors"
          >
            {CTA_LABEL}
          </a>
        </div>

        <div className="flex items-center gap-2 xl:hidden">
          <LangToggle />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <div
        id="mobile-menu"
        className={cn(
          "border-border bg-background max-h-[calc(100svh-4rem)] overflow-y-auto border-b xl:hidden",
          open ? "block" : "hidden"
        )}
      >
        <ul className="flex flex-col gap-1 px-6 py-4">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-2 py-2 text-sm"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/login"
              className="block rounded-md px-2 py-2 text-sm"
              onClick={() => setOpen(false)}
            >
              Login
            </Link>
          </li>
          <li className="mt-2">
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium"
              onClick={() => setOpen(false)}
            >
              {CTA_LABEL}
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
