import Link from "next/link";

import { BRAND, NAV_ITEMS } from "@/constants/brand";

export function Footer() {
  return (
    <footer id="site-footer" className="bg-brand text-brand-neutral px-6 py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="inline-block">
              <p className="font-display text-2xl tracking-[0.32em]">
                {BRAND.name}
              </p>
              <p className="text-gold mt-2 text-center text-[10px] tracking-[0.12em] uppercase">
                {BRAND.slogan}
              </p>
            </div>
            <p className="mt-4 text-sm leading-relaxed opacity-70 italic">
              {BRAND.strapline}
            </p>
          </div>

          <nav aria-label="Footer">
            <p className="text-xs font-medium tracking-[0.3em] uppercase opacity-60">
              Explore
            </p>
            <ul className="mt-4 space-y-2.5">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm opacity-80 transition-opacity hover:opacity-100"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-xs font-medium tracking-[0.3em] uppercase opacity-60">
              Follow
            </p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a
                  href={BRAND.socials.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm opacity-80 transition-opacity hover:opacity-100"
                >
                  TikTok
                </a>
              </li>
              <li>
                <a
                  href={BRAND.socials.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm opacity-80 transition-opacity hover:opacity-100"
                >
                  Instagram
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${BRAND.email}`}
                  className="text-sm break-words opacity-80 transition-opacity hover:opacity-100 [overflow-wrap:anywhere]"
                >
                  {BRAND.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/*
          The only permitted reference to the agency on this site.
          ELFIA is presented as an independent brand.
        */}
        <div className="mt-10 flex flex-col gap-3 border-t border-current/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs opacity-60">
            © {new Date().getFullYear()} {BRAND.legalName}. All rights reserved.
          </p>
          <a
            href={BRAND.poweredBy.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs opacity-60 transition-opacity hover:opacity-100"
          >
            {BRAND.poweredBy.label}
          </a>
        </div>
      </div>
    </footer>
  );
}
