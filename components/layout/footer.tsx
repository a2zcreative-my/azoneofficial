import { Facebook, Instagram, Music2 } from "lucide-react";
import Link from "next/link";

import { CONTACT, whatsappUrl } from "@/constants/content";
import { CTA_LABEL, NAV_ITEMS, SITE_CONFIG } from "@/constants/site";

const SOCIAL_LINKS = [
  { label: "TikTok", href: CONTACT.socials.tiktok, icon: Music2 },
  { label: "Instagram", href: CONTACT.socials.instagram, icon: Instagram },
  { label: "Facebook", href: CONTACT.socials.facebook, icon: Facebook },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-brand px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <p className="text-sm font-semibold tracking-[0.2em] uppercase">
              {SITE_CONFIG.name}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              {SITE_CONFIG.tagline}. Home of {SITE_CONFIG.brand.fashion}.
            </p>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold mt-6 inline-flex items-center text-sm font-medium hover:underline"
            >
              {CTA_LABEL} →
            </a>
          </div>

          <div className="grid grid-cols-2 gap-12 sm:grid-cols-2">
            <nav aria-label="Footer">
              <p className="text-xs font-medium tracking-[0.2em] text-white/40 uppercase">
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
              <p className="text-xs font-medium tracking-[0.2em] text-white/40 uppercase">
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
                    className="text-sm text-white/70 transition-colors hover:text-white"
                  >
                    {CONTACT.email}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-white/40">
            © {year} {SITE_CONFIG.legalName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
