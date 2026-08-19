import { Facebook, Instagram, Music2 } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
import { CONTACT, whatsappUrl } from "@/constants/content";
import { OUR_COMPANIES, PUBLISHABLE_CLIENTS } from "@/constants/brands";
import { CTA_LABEL, NAV_ITEMS, SITE_CONFIG } from "@/constants/site";

const SOCIAL_LINKS = [
  { label: "TikTok", href: CONTACT.socials.tiktok, icon: Music2 },
  { label: "Instagram", href: CONTACT.socials.instagram, icon: Instagram },
  { label: "Facebook", href: CONTACT.socials.facebook, icon: Facebook },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer id="site-footer" className="bg-brand px-6 py-12 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4 md:gap-8">
          <div className="max-w-sm md:col-span-2">
            {/*
              Lockup: an inline-block wrapper shrinks to the logo's width, so
              centring the strapline inside it centres it under the mark —
              rather than against the left edge of the whole footer column.
            */}
            <div className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-white.png"
                alt={SITE_CONFIG.name}
                className="h-12 w-auto"
              />
              <p className="text-gold mt-2.5 text-center text-[9px] font-medium tracking-[0.08em] uppercase">
                {SITE_CONFIG.brandTagline}
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              <Editable k="footer.slogan" fallback={SITE_CONFIG.slogan} />
            </p>
            <p className="mt-4 text-xs leading-relaxed text-white/50">
              {SITE_CONFIG.address}
            </p>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold mt-5 inline-flex items-center text-sm font-medium hover:underline"
            >
              {CTA_LABEL} →
            </a>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-6 sm:gap-8 md:col-span-2">
            <nav aria-label="Footer" className="min-w-0">
              <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">
                Explore
              </p>
              <ul className="mt-4 space-y-2">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-white/70 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">
                Follow us
              </p>
              <ul className="mt-4 space-y-2">
                {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-white/70 transition-colors hover:text-white"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="text-sm break-words text-white/70 transition-colors hover:text-white [overflow-wrap:anywhere]"
                  >
                    {CONTACT.email}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* v1.30.0 — OUR COMPANIES. A2Z and AZ ONE OFFICIAL are separate
            legal entities under one roof, each with its own website; a
            visitor should be able to see that at a glance and jump straight
            to the right one. Every link is generated from constants/brands.ts
            — no domain is written into this file, so a move is one edit
            there. Clients are a SEPARATE block below and only appear with
            written permission on file: one shared row of logos would quietly
            claim we own our clients too. */}
        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            Our companies
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {OUR_COMPANIES.map((b) => {
              const isSelf = b.url === SITE_CONFIG.url;
              const inner = (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.logo} alt={b.name} className="h-7 w-auto shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-white/90">{b.name}</span>
                    <span className="block truncate text-[11px] text-white/50">{b.descriptor}</span>
                  </span>
                </>
              );
              return (
                <li key={b.code}>
                  {isSelf ? (
                    <span
                      className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5"
                      aria-current="page"
                    >
                      {inner}
                    </span>
                  ) : (
                    <a
                      href={b.url}
                      rel="noopener"
                      className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5 transition-colors hover:border-white/25 hover:bg-white/5"
                    >
                      {inner}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {PUBLISHABLE_CLIENTS.length > 0 && (
            <>
              <p className="mt-6 text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
                Clients
              </p>
              <ul className="mt-3 flex flex-wrap items-center gap-3">
                {PUBLISHABLE_CLIENTS.map((b) => (
                  <li key={b.code}>
                    <a href={b.url} rel="noopener"
                      className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 transition-colors hover:border-white/25 hover:bg-white/5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.logo} alt={b.name} className="h-6 w-auto" />
                      <span className="text-xs text-white/80">{b.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/60">
            © {year} {SITE_CONFIG.legalName}. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <Link
                href="/faq"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                FAQ
              </Link>
            </li>
            <li>
              <Link
                href="/case-studies"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Case Studies
              </Link>
            </li>
            <li>
              <Link
                href="/careers"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Careers
              </Link>
            </li>
            <li>
              <Link
                href="/privacy"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Terms &amp; Conditions
              </Link>
            </li>
            <li>
              <Link
                href="/login"
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Login
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
