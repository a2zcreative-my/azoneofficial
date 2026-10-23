"use client";

/* v1.197.0 - THE PUBLIC NAVBAR, on the owner's homepage mockup: a solid white
   bar, the A2Z mark with the company name beside it, Home and the six pages
   in one row (Home underlined in gold where you are; Services opens the six
   services), EN | BM, and the gold "Get a free live audit" pill.
   Blog and Login stay in the phone menu and the footer, exactly as before;
   on a wide screen Login is the person icon beside the language toggle.

   v1.32.1's lesson stands: in Bahasa Melayu the row is long, so the full row
   appears only from 1180px (measured in both languages at 1180-1920px)
   and below that the menu button takes over - the language toggle stays
   outside it so a BM reader never has to open a menu to find their language.
   CSS Module only: Tailwind is retired (tests/tailwind-retired.mjs). */

import { ArrowRight, ChevronDown, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LangToggle } from "@/components/live/lang-runtime";
import { SERVICES, serviceSlug, whatsappUrl } from "@/constants/content";
import { CTA_LABEL, NAV_ITEMS, SITE_CONFIG } from "@/constants/site";

import nav from "./navbar.module.css";

/* the desktop row: Home, then every page but Blog (Blog is in the footer
   and the phone menu - the mockup's row has seven entries) */
const ROW = [{ label: "Home", href: "/" }, ...NAV_ITEMS.filter((i) => i.href !== "/blog")];

function isHere(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Navbar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [svc, setSvc] = useState(false);
  const svcRef = useRef<HTMLLIElement>(null);

  /* the services menu closes on Escape and on a press anywhere else */
  useEffect(() => {
    if (!svc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSvc(false); };
    const onDown = (e: PointerEvent) => {
      if (svcRef.current && !svcRef.current.contains(e.target as Node)) setSvc(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [svc]);

  return (
    <header className={nav.bar}>
      <nav aria-label="Main" className={nav.inner}>
        <Link href="/" onClick={() => setOpen(false)} className={nav.brand} aria-label={SITE_CONFIG.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className={nav.logo} width={991} height={547} />
          <span className={nav.wordmark} data-no-translate aria-hidden="true">
            <span>A2Z Creative</span>
            <span>Marketing</span>
          </span>
        </Link>

        <ul className={nav.links}>
          {ROW.map((item) => {
            const here = isHere(pathname, item.href);
            if (item.href === "/services") {
              return (
                <li key={item.href} ref={svcRef} className={`${nav.hasMenu} ${svc ? nav.menuOpen : ""}`}>
                  <span className={nav.split}>
                    <Link href={item.href} className={`${nav.link} ${here ? nav.here : ""}`} aria-current={here ? "page" : undefined}>
                      {item.label}
                    </Link>
                    <button
                      type="button"
                      className={nav.caret}
                      aria-expanded={svc}
                      aria-controls="nav-services"
                      aria-label="Show services"
                      onClick={() => setSvc((v) => !v)}
                    >
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </span>
                  <ul id="nav-services" className={nav.menu}>
                    {SERVICES.map((s) => (
                      <li key={s.title}>
                        <Link href={`/services#${serviceSlug(s.title)}`} className={nav.menuItem} onClick={() => setSvc(false)}>
                          <s.icon aria-hidden="true" />
                          <span>{s.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            }
            return (
              <li key={item.href}>
                <Link href={item.href} className={`${nav.link} ${here ? nav.here : ""}`} aria-current={here ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={nav.tools}>
          <LangToggle />
          <Link href="/login" className={nav.login} aria-label="Login" title="Login">
            <UserRound aria-hidden="true" />
          </Link>
          <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className={nav.cta}>
            <span>{CTA_LABEL}</span>
            <ArrowRight aria-hidden="true" />
          </a>
        </div>

        <div className={nav.phoneTools}>
          <LangToggle />
          <button
            type="button"
            className={nav.menuBtn}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <div id="mobile-menu" className={nav.sheet} hidden={!open}>
        <ul className={nav.sheetList}>
          {[{ label: "Home", href: "/" }, ...NAV_ITEMS].map((item) => {
            const here = isHere(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${nav.sheetLink} ${here ? nav.sheetHere : ""}`}
                  aria-current={here ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <Link href="/login" className={nav.sheetLink} onClick={() => setOpen(false)}>
              Login
            </Link>
          </li>
          <li className={nav.sheetCta}>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className={`${nav.cta} ${nav.ctaBlock}`}
              onClick={() => setOpen(false)}
            >
              <span>{CTA_LABEL}</span>
              <ArrowRight aria-hidden="true" />
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
