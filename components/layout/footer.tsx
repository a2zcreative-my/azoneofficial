"use client";

/* Website restructure (18-11-2026, unreleased) - THE SITE FOOTER, homepage section F of the owner's brief
   (18-11-2026): authentic contact details, social links, the company, links
   to every service and to the existing pages (About, Consultancy, Packages,
   Portfolio, Case Studies, Blog, Careers, Contact, FAQ, the legal pages and
   Login). CSS Module only - it used to be legacy utility classes.

   Kept from v1.30.0 / v1.33.0: OUR COMPANIES and CLIENTS are separate,
   labelled groups (a shared row would claim we own our clients), every brand
   URL comes from constants/brands.ts, and the navy footer always draws a
   brand's logoOnDark (tests/brands-guard.mjs).

   A client component only so the service links follow the page's language
   (/ms pages link the BM service pages). */
import { ArrowRight, Facebook, Instagram, Music2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Editable } from "@/components/live/editable";
import { OUR_COMPANIES, PUBLISHABLE_CLIENTS } from "@/constants/brands";
import { CONTACT } from "@/constants/content";
import { SERVICE_PAGES, displayPhone, isMsPath, serviceForPath, servicePath, serviceWhatsApp } from "@/constants/services";
import { CTA_LABEL, SITE_CONFIG } from "@/constants/site";

import css from "./footer.module.css";

const SOCIAL_LINKS = [
  { label: "TikTok", href: CONTACT.socials.tiktok, icon: Music2 },
  { label: "Instagram", href: CONTACT.socials.instagram, icon: Instagram },
  { label: "Facebook", href: CONTACT.socials.facebook, icon: Facebook },
] as const;

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/consultancy", label: "Consultancy" },
  { href: "/packages", label: "Packages" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/blog", label: "Blog" },
  { href: "/careers", label: "Careers" },
  { href: "/contact", label: "Contact" },
] as const;

const SECONDARY_LINKS = [
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/login", label: "Login" },
] as const;

export function Footer() {
  const pathname = usePathname() ?? "/";
  const lang = isMsPath(pathname) ? "ms" : "en";
  const here = serviceForPath(pathname);
  const wa = serviceWhatsApp(here?.s ?? null, lang);
  const year = new Date().getFullYear();

  return (
    <footer id="site-footer" className={css.foot}>
      <div className={css.wrap}>
        <div className={css.statement}>
          <p className={css.statementTitle} data-no-translate>
            Build the brand.<span>Sell it live.</span>
          </p>
          <a href={wa} target="_blank" rel="noopener noreferrer" className={css.statementBtn}>
            <span>{CTA_LABEL}</span>
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
        <div className={css.top}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-white.png" alt={SITE_CONFIG.name} className={css.logo} width={991} height={547} />
            <p className={css.tag} data-no-translate>{SITE_CONFIG.brandTagline}</p>
            <p className={css.about}>
              <Editable k="footer.slogan" fallback={SITE_CONFIG.slogan} />
            </p>
            <ul className={css.contact}>
              <li data-no-translate>{SITE_CONFIG.address}</li>
              <li>
                WhatsApp{" "}
                <a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a>
              </li>
              <li>
                <a href={`mailto:${CONTACT.email}`} data-no-translate>{CONTACT.email}</a>
              </li>
            </ul>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={css.cta}>
              <span>{CTA_LABEL}</span>
              <ArrowRight aria-hidden="true" />
            </a>
          </div>

          <nav aria-label="Services">
            <p className={css.head}>Services</p>
            <ul className={css.list}>
              {SERVICE_PAGES.map((s) => (
                <li key={s.key}>
                  <Link href={servicePath(s, lang)}>{s[lang].name}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className={css.cols}>
            <nav aria-label="Company">
              <p className={css.head}>Company</p>
              <ul className={css.list}>
                {COMPANY_LINKS.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <p className={css.head}>Follow us</p>
              <ul className={css.list}>
                {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
                  <li key={label}>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      <Icon aria-hidden="true" />
                      <span data-no-translate>{label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className={css.brands} data-footer="brands">
          <div className={css.group}>
            <span className={css.groupLabel}>Our companies</span>
            <ul className={css.marks} data-footer="companies">
              {OUR_COMPANIES.map((b) => {
                const isSelf = b.url === SITE_CONFIG.url;
                /* eslint-disable-next-line @next/next/no-img-element */
                const mark = <img src={b.logoOnDark} alt={b.name} title={`${b.name} — ${b.descriptor}`} className={css.mark} />;
                return (
                  <li key={b.code}>
                    {isSelf ? (
                      <span aria-current="page" className={css.self}>{mark}</span>
                    ) : (
                      <a href={b.url} rel="noopener" aria-label={`${b.name} — ${b.descriptor}`}>{mark}</a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {PUBLISHABLE_CLIENTS.length > 0 && (
            <>
              <span className={css.rule} aria-hidden="true" />
              <div className={css.group}>
                <span className={css.groupLabel}>Clients</span>
                <ul className={css.marks} data-footer="clients">
                  {PUBLISHABLE_CLIENTS.map((b) => (
                    <li key={b.code}>
                      <a href={b.url} rel="noopener" aria-label={b.name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.logoOnDark} alt={b.name} className={css.mark} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        <div className={css.legal}>
          <p className={css.copy}>
            © {year} <span data-no-translate>{SITE_CONFIG.legalName}</span>. All rights reserved.
          </p>
          <ul className={css.small}>
            {SECONDARY_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
