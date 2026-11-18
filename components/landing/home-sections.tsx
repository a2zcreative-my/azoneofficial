/* Website restructure (18-11-2026, unreleased) - THE HOMEPAGE, sections A to E (the owner's brief, 18-11-2026).
   F, the footer, is components/layout/footer.tsx (shared by every page).

   A Hero      the original navy hero and brand statement, what we do and
               where, Get a Free Consultation + View Our Work, WhatsApp
   B Services  the eight official services, 4 x 2 on a desktop
   C Work      real work only (ELFIA, our own live channels, our sister
               company's website)
   D Why A2Z   four short, checkable reasons
   E Consult   WhatsApp, phone, email, address and a minimal enquiry form

   Server components; only the enquiry form runs in the browser. Every word
   comes from constants/home-copy.ts or constants/services.ts, in EN or BM. */

import { ArrowRight, Globe2, Languages, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";

import { EnquiryForm } from "@/components/landing/enquiry-form";
import { brandByCode } from "@/constants/brands";
import { CONTACT, HOME_MEDIA, LIVE_SHOWCASE } from "@/constants/content";
import { HOME_COPY } from "@/constants/home-copy";
import { SERVICE_PAGES, displayPhone, servicePath, serviceWhatsApp, type Lang } from "@/constants/services";
import { SITE_CONFIG } from "@/constants/site";

import css from "./landing.module.css";

const FACT_ICONS = [MapPin, Globe2, Languages] as const;

/* ---------------------------------------------------------------- A */
export function Hero({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].hero;
  const wa = serviceWhatsApp(null, lang);
  const photo = HOME_MEDIA.hero.src;
  return (
    <section id="top" className={css.hero} aria-labelledby="hero-title">
      <div className={css.wrap}>
        <div className={css.heroGrid}>
          <div>
            <p className={css.heroEyebrow} data-no-translate>{t.eyebrow}</p>
            <h1 id="hero-title" className={css.heroTitle} data-no-translate>
              <span>{t.line1}</span>
              <span className={css.heroGold}>{t.line2}</span>
            </h1>
            <p className={css.heroLede}>{t.lede}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <a className={css.btnGold} href="#consultation">
                <span>{t.primary}</span>
                <ArrowRight aria-hidden="true" />
              </a>
              <a className={css.btnGhost} href="#work">
                <span>{t.secondary}</span>
              </a>
            </div>
            <ul className={css.facts}>
              {t.facts.map((f, i) => {
                const Icon = FACT_ICONS[i] ?? MapPin;
                return (
                  <li key={f.title} className={css.fact}>
                    <Icon aria-hidden="true" />
                    <div>
                      <strong>{f.title}</strong>
                      <span>{f.text}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <a className={css.heroWa} href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              <span>{t.whatsapp} <strong data-no-translate>{displayPhone()}</strong></span>
            </a>
          </div>
          {photo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className={css.heroPhoto} src={photo} alt={HOME_MEDIA.hero.alt} fetchPriority="high" />
          ) : (
            <aside className={css.panel} aria-label={t.panelTitle}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={css.panelLogo} src="/logo-white.png" alt={SITE_CONFIG.name} width={991} height={547} />
              <h2 className={css.panelTitle}>{t.panelTitle}</h2>
              <p className={css.panelText}>{t.panelText}</p>
              <a className={css.btnWa} href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                <span>{t.panelCta}</span>
              </a>
              <span className={css.panelPhone}>
                WhatsApp <a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a>
              </span>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- B */
export function ServicesGrid({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].services;
  return (
    <section id="services" className={`${css.section} ${css.grey}`} aria-labelledby="services-title">
      <div className={css.wrap}>
        <div className={`${css.head} ${css.headRow}`}>
          <div>
            <p className={css.eyebrow}>{t.eyebrow}</p>
            <h2 id="services-title" className={css.h2}>{t.title}</h2>
            <p className={css.lede}>{t.lede}</p>
          </div>
          <Link className={css.textLink} href="/services">
            <span>{t.all}</span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <ul className={css.cards}>
          {SERVICE_PAGES.map((s) => {
            const c = s[lang];
            const Icon = s.icon;
            return (
              <li key={s.key}>
                <Link className={css.card} href={servicePath(s, lang)}>
                  <span className={css.cardIcon} aria-hidden="true"><Icon /></span>
                  <h3 className={css.cardTitle}>{c.name}</h3>
                  <p className={css.cardText}>{c.card}</p>
                  <span className={css.cardMore} aria-hidden="true">{t.more}<ArrowRight /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- C */
interface WorkCard {
  key: string;
  chip: string;
  title: string;
  text: string;
  tags: string;
  href: string;
  external: boolean;
  logo?: string;
  handle?: string;
}

function workCards(lang: Lang): WorkCard[] {
  const en = lang === "en";
  const elfia = brandByCode("elfia");
  const azone = brandByCode("azone");
  const handle = `@${LIVE_SHOWCASE.tiktokProfileUrl.split("@")[1] ?? ""}`;
  const out: WorkCard[] = [];
  if (elfia?.permissionOnFile) {
    out.push({
      key: "elfia",
      chip: en ? "Client" : "Klien",
      title: elfia.name,
      text: en
        ? "We built the brand's live selling channel from zero and run it end to end, with the brand's own online store."
        : "Kami membina saluran jualan live jenama ini dari kosong dan menguruskannya sepenuhnya, bersama kedai dalam talian jenama itu sendiri.",
      tags: en ? "Live Commerce · Live Host · Website · Design" : "Live Commerce · Live Host · Laman Web · Reka Bentuk",
      href: elfia.url,
      external: true,
      logo: elfia.logoOnDark,
    });
  }
  out.push({
    key: "live",
    chip: HOME_COPY[lang].work.note,
    title: en ? "Our TikTok & Shopee live channels" : "Saluran live TikTok & Shopee kami",
    text: en
      ? "Our own live channels - hosted, produced and moderated by the same team that runs our clients' sessions."
      : "Saluran live kami sendiri - dihoskan, dihasilkan dan dimoderasi oleh pasukan yang sama yang menjalankan sesi klien kami.",
    tags: en ? "Live Host · Live Commerce · Mobilegraphy" : "Live Host · Live Commerce · Mobilegraphy",
    href: LIVE_SHOWCASE.tiktokProfileUrl,
    external: true,
    handle,
  });
  if (azone) {
    out.push({
      key: "azone",
      chip: en ? "Our consultancy company" : "Syarikat perundingan kami",
      title: azone.name,
      text: en
        ? "Website and enquiry pages for AZ ONE OFFICIAL, the consultancy company of our group."
        : "Laman web dan halaman pertanyaan untuk AZ ONE OFFICIAL, syarikat perundingan dalam kumpulan kami.",
      tags: en ? "Website · Design" : "Laman Web · Reka Bentuk",
      href: azone.url,
      external: true,
      logo: azone.logoOnDark,
    });
  }
  return out;
}

export function SelectedWork({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].work;
  return (
    <section id="work" className={css.section} aria-labelledby="work-title">
      <div className={css.wrap}>
        <div className={`${css.head} ${css.headRow}`}>
          <div>
            <p className={css.eyebrow}>{t.eyebrow}</p>
            <h2 id="work-title" className={css.h2}>{t.title}</h2>
            <p className={css.lede}>{t.lede}</p>
          </div>
          <Link className={css.textLink} href="/portfolio">
            <span>{t.all}</span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <ul className={css.work}>
          {workCards(lang).map((c) => {
            const photo = HOME_MEDIA.work[c.key];
            return (
              <li key={c.key}>
                <a className={css.workCard} href={c.href} target={c.external ? "_blank" : undefined} rel={c.external ? "noopener noreferrer" : undefined}>
                  <span className={css.workMedia}>
                    {photo?.src ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={css.workPhoto} src={photo.src} alt={photo.alt} loading="lazy" />
                    ) : c.logo ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={css.workLogo} src={c.logo} alt="" loading="lazy" />
                    ) : (
                      <span className={css.workHandle} data-no-translate>{c.handle}</span>
                    )}
                    <span className={css.workChip}>{c.chip}</span>
                  </span>
                  <span className={css.workBody}>
                    <h3 className={css.workTitle} data-no-translate={c.key !== "live" || undefined}>{c.title}</h3>
                    <span className={css.workText}>{c.text}</span>
                    <span className={css.workTags}>{c.tags}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- D */
export function WhyA2z({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].why;
  return (
    <section id="why" className={`${css.section} ${css.grey}`} aria-labelledby="why-title">
      <div className={css.wrap}>
        <div className={css.head}>
          <p className={css.eyebrow}>{t.eyebrow}</p>
          <h2 id="why-title" className={css.h2}>{t.title}</h2>
        </div>
        <ul className={css.why}>
          {t.points.map((p) => (
            <li key={p.title} className={css.whyItem}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- E */
export function Consultation({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].consult;
  const wa = serviceWhatsApp(null, lang);
  return (
    <section id="consultation" className={css.section} aria-labelledby="consult-title">
      <div className={css.wrap}>
        <div className={css.consult}>
          <div>
            <p className={css.eyebrow}>{t.eyebrow}</p>
            <h2 id="consult-title" className={css.h2}>{t.title}</h2>
            <p className={css.lede}>{t.lede}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <a className={css.btnGold} href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                <span>{HOME_COPY[lang].hero.whatsapp}</span>
              </a>
            </div>
            <ContactList lang={lang} />
            <p className={css.hours}>{t.hours}</p>
          </div>
          <EnquiryForm lang={lang} />
        </div>
      </div>
    </section>
  );
}

export function ContactList({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].consult;
  const wa = serviceWhatsApp(null, lang);
  return (
    <ul className={css.contactList}>
      <li className={css.contactItem}>
        <MessageCircle aria-hidden="true" />
        <div><strong>{t.whatsapp}</strong><a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a></div>
      </li>
      <li className={css.contactItem}>
        <Phone aria-hidden="true" />
        <div><strong>{t.call}</strong><a href={`tel:+${CONTACT.whatsapp}`} data-no-translate>{displayPhone()}</a></div>
      </li>
      <li className={css.contactItem}>
        <Mail aria-hidden="true" />
        <div><strong>{t.email}</strong><a href={`mailto:${CONTACT.email}`} data-no-translate>{CONTACT.email}</a></div>
      </li>
      <li className={css.contactItem}>
        <MapPin aria-hidden="true" />
        <div><strong>{t.visit}</strong><span data-no-translate>{SITE_CONFIG.address}</span></div>
      </li>
    </ul>
  );
}
