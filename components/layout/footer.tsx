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

/* The bottom bar. Real pages, but not the main journey — they belong on the
   legal line beside the copyright, not in a column of their own. */
const SECONDARY_LINKS = [
  { href: "/faq", label: "FAQ" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/careers", label: "Careers" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/login", label: "Login" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    /* v1.33.2 (CEO sent a phone photo of the live footer: "I more prefer like
       this!") — back to the LEFT-ALIGNED brand block with the two headed
       columns, EXPLORE and FOLLOW US, which is the layout he was pointing at.
       v1.33.1's centred rows are gone.

       The size constraint from the message before it still stands, so the
       same layout is arranged to cost less: the brand block and the link
       columns sit SIDE BY SIDE from md up instead of stacking (that stacking
       was most of the old 1080px), the company/client cards stay as a compact
       row of marks, and the secondary pages ride on the legal bar rather than
       forming a third column. Left-aligned costs a little more than centred
       rows did — it is still far below where this started.

       Reference numbers, all measured, at 1280 / 768 / 390:
         original (v1.32.1)   1080 / 1080 / 1208
         centred (v1.33.1)     433 /  451 /  647
         this                  see scratch/footer-e2e.mjs — budgeted.

       One deliberate difference from the photo: the email has moved OUT of
       the FOLLOW US column and into the brand block under the address. In the
       photo it is rendering as "admin@azoneofficial.c / om" — half a phone
       column is not enough room for it, and an address you cannot read in one
       piece is not much of an address. It sits with the other contact
       details now, where it has the width it needs. */
    <footer id="site-footer" className="bg-brand px-6 py-10 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
          {/* --- brand block, left --- */}
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-white.png"
              alt={SITE_CONFIG.name}
              className="h-11 w-auto"
            />
            <p className="text-gold mt-2.5 text-[10px] font-medium tracking-[0.18em] uppercase">
              {SITE_CONFIG.brandTagline}
            </p>
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-white/60">
              <Editable k="footer.slogan" fallback={SITE_CONFIG.slogan} />
            </p>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/50">
              {SITE_CONFIG.address}
            </p>
            <p className="mt-1.5">
              <a
                href={`mailto:${CONTACT.email}`}
                className="text-xs text-white/50 transition-colors hover:text-white"
              >
                {CONTACT.email}
              </a>
            </p>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold mt-4 inline-flex items-center text-sm font-medium hover:underline"
            >
              {CTA_LABEL} →
            </a>
          </div>

          {/* --- the two columns, right --- */}
          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            <nav aria-label="Footer" className="min-w-0">
              <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">
                Explore
              </p>
              <ul className="mt-3 space-y-1.5">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm whitespace-nowrap text-white/70 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0">
              <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">
                Follow us
              </p>
              <ul className="mt-3 space-y-1.5">
                {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm whitespace-nowrap text-white/70 transition-colors hover:text-white"
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* v1.30.0 — OUR COMPANIES and CLIENTS are separate labelled groups on
            purpose. A2Z and AZ ONE OFFICIAL are two legal entities under one
            roof; ELFIA is a client who gave permission to be named. One shared
            row of logos would quietly claim we own our clients too. Kept as a
            compact row of marks rather than bordered cards — the descriptions
            live in each link's accessible name and tooltip. Every URL comes
            from constants/brands.ts; no domain is written into this file. */}
        <div
          data-footer="brands"
          className="mt-8 flex flex-col gap-x-10 gap-y-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap text-white/35 uppercase">
              Our companies
            </span>
            <ul data-footer="companies" className="flex items-center gap-4">
              {OUR_COMPANIES.map((b) => {
                const isSelf = b.url === SITE_CONFIG.url;
                const mark = (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.logoOnDark}
                    alt={b.name}
                    title={`${b.name} — ${b.descriptor}`}
                    className="h-6 w-auto max-w-[110px] object-contain"
                  />
                );
                return (
                  <li key={b.code}>
                    {isSelf ? (
                      <span aria-current="page" className="block opacity-60">
                        {mark}
                      </span>
                    ) : (
                      <a
                        href={b.url}
                        rel="noopener"
                        aria-label={`${b.name} — ${b.descriptor}`}
                        className="block opacity-70 transition-opacity hover:opacity-100"
                      >
                        {mark}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {PUBLISHABLE_CLIENTS.length > 0 && (
            <>
              {/* A visible rule between the two groups. With only a gap, the
                  eye could bracket "AZ ONE" together with "CLIENTS" — the one
                  reading of this row that must never happen. */}
              <span
                className="hidden h-5 w-px bg-white/15 sm:block"
                aria-hidden="true"
              />
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap text-white/35 uppercase">
                  Clients
                </span>
                <ul data-footer="clients" className="flex items-center gap-4">
                  {PUBLISHABLE_CLIENTS.map((b) => (
                    <li key={b.code}>
                      <a
                        href={b.url}
                        rel="noopener"
                        aria-label={b.name}
                        className="block opacity-70 transition-opacity hover:opacity-100"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.logoOnDark}
                          alt={b.name}
                          className="h-6 w-auto max-w-[110px] object-contain"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Legal bar: copyright left, the secondary pages right. They used to
            be a stacked block of their own; on one line they cost nothing. */}
        <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-white/50">
            © {year} {SITE_CONFIG.legalName}. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5 md:justify-end">
            {SECONDARY_LINKS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-[11px] whitespace-nowrap text-white/50 transition-colors hover:text-white"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
