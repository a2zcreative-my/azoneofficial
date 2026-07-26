import { Facebook, Instagram, Music2 } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
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
    <footer id="site-footer" className="bg-brand px-6 py-12 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid gap-10 md:grid-cols-4 md:gap-8">
          <div className="max-w-sm md:col-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-white.png"
              alt={SITE_CONFIG.name}
              className="h-8 w-auto"
            />
            <p className="text-gold mt-3 text-xs font-medium tracking-[0.35em] uppercase">
              {SITE_CONFIG.brandTagline}
            </p>
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

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
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
