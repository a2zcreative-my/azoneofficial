"use client";

/**
 * v1.128.0 — the digital business card's body, bilingual.
 * v1.218.0 — Cards 2.0 (the owner's brief and answers, 28-10-2026: "Full
 * redesign", "Website only"): the same page at the same URL from the same
 * record, redrawn as a premium card - the A2Z logo and the BM/EN switch on a
 * navy face, a large photo in a gold ring, the name and title, a full-width
 * gold Save contact, WhatsApp, an icon row (Call, Email, Website, Location),
 * and "Share this card" (the phone's own share sheet, or the link copied).
 * The page now pads for the notch and the home bar (viewport-fit=cover is
 * site-wide). Styles moved to card-view.module.css.
 *
 * CEO, 06-09-2026: a BM/EN switcher on /farhan, /zoll and /izz, defaulting to
 * BM, switching without a page reload, holding the choice while the visitor
 * moves around the card, and translating everything a client can read.
 *
 * WHY THIS COMPONENT EXISTS AT ALL
 * The page above it stays a SERVER component: it owns generateStaticParams,
 * generateMetadata and the schema.org block, none of which can live in a
 * component that holds state. Only the readable body is here, so the card is
 * still a file on a CDN with one small script on it - no fetch, no API: a
 * printed URL has to open on a bad day.
 *
 * NO FLASH, AND NO HYDRATION MISMATCH
 * The initial render is BM on both sides - server HTML and first client
 * render - so React hydrates against exactly what it sent. Only a visitor who
 * previously chose EN sees one repaint, after mount.
 *
 * ONE LANGUAGE PREFERENCE PER DEVICE
 * The card reads and writes the site's own key (`azone-lang`) and event, so a
 * visitor who switches here stays in that language on the rest of the site.
 * The card carries `data-no-translate` so the site-wide text-swap runtime
 * leaves it alone: it renders from typed pairs instead.
 *
 * ONE PIECE OF STATE. "Share this card" holds none: the share sheet is the
 * phone's, and the "Link copied" receipt is written on the button itself.
 *
 * ONLY THE RECORD. Everything shown comes from constants/team.ts (the
 * approved public profile), constants/card-copy.ts and SITE_CONFIG - never
 * from a staff record.
 */

import { Globe, Mail, MapPin, MessageCircle, Phone, Share2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type MouseEvent } from "react";

import { CARD_COPY, CARD_LINKS, pick, type CardLang } from "@/constants/card-copy";
import { SITE_CONFIG } from "@/constants/site";
import { CARD_COMPANY, cardMonogram, type TeamCard } from "@/constants/team";
import css from "./card-view.module.css";

/** The same storage key and event the site-wide toggle uses (v1.32.0). */
const KEY = "azone-lang";
const EVENT = "azone-lang-change";

const MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  SITE_CONFIG.address,
)}`;

/** The short role chip on the photo: the part after the slash ("CEO"). */
const badge = (role: string) => role.split("/").pop()?.trim() ?? "";

function LangSwitch({ lang, onChange }: { lang: CardLang; onChange: (l: CardLang) => void }) {
  /* A segmented pair, not a toggle: a visitor sees WHICH language is on.
     Two real buttons with aria-pressed - actions, not a form field. */
  return (
    <div role="group" aria-label={`${CARD_COPY.langLabel.ms} / ${CARD_COPY.langLabel.en}`} className={css.lang}>
      <button type="button" lang="ms" aria-pressed={lang === "ms"} onClick={() => onChange("ms")}>
        BM
      </button>
      <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => onChange("en")}>
        EN
      </button>
    </div>
  );
}

export function CardView({ m, embedded = false }: { m: TeamCard; embedded?: boolean }) {
  /* BM on the server AND on the first client render - see the header note. */
  const [lang, setLang] = useState<CardLang>("ms");

  useEffect(() => {
    /* Only an explicit earlier choice of English moves the card off Malay. */
    try {
      if (window.localStorage.getItem(KEY) === "en") setLang("en");
    } catch {
      /* private mode: the default stands */
    }
    const sync = () => {
      try {
        setLang(window.localStorage.getItem(KEY) === "en" ? "en" : "ms");
      } catch { /* ignore */ }
    };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const choose = useCallback((next: CardLang) => {
    setLang(next);
    try {
      window.localStorage.setItem(KEY, next);
      window.dispatchEvent(new Event(EVENT));
    } catch { /* private mode: the card still switched, it just will not stick */ }
    if (!embedded) document.documentElement.lang = next === "ms" ? "ms" : "en";
  }, [embedded]);

  const t = (v: { en: string; ms: string }) => pick(v, lang);
  const cardUrl = `${SITE_CONFIG.url}/${m.slug}`;
  const waHref = `https://wa.me/${m.mobileE164.replace(/[^0-9]/g, "")}`;
  const duties = m.duties[lang];

  /* The phone's own share sheet; where there is none, the link is copied and
     the button says so on itself for two seconds (no second state). */
  const share = async (e: MouseEvent<HTMLButtonElement>) => {
    const label = e.currentTarget.querySelector("[data-label]");
    const nav = window.navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try { await nav.share({ title: `${m.name} - ${t(m.role)}`, text: `${m.name} - ${t(m.role)}, ${SITE_CONFIG.name}`, url: cardUrl }); } catch { /* cancelled */ }
      return;
    }
    try {
      await nav.clipboard.writeText(cardUrl);
      if (label) {
        label.textContent = t(CARD_COPY.shared);
        window.setTimeout(() => { label.textContent = t(CARD_COPY.share); }, 2000);
      }
    } catch { /* clipboard refused: the address bar still holds the link */ }
  };

  return (
    /* data-no-translate: the site-wide BM runtime skips this subtree. */
    <main data-no-translate className={`${css.page} ${embedded ? css.embedded : ""}`}>
      <article className={css.card} aria-label={`${m.name} - ${t(m.role)}`}>
        {/* ---- the navy face ---- */}
        <header className={css.face}>
          <div className={css.top}>
            <Link href="/" className={css.brand} aria-label={SITE_CONFIG.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-white.png" alt="" width={991} height={547} className={css.logo} />
              <span>{SITE_CONFIG.name}</span>
            </Link>
            <LangSwitch lang={lang} onChange={choose} />
          </div>
          <div className={css.portrait}>
            {m.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.photo} alt={m.name} width={224} height={224} className={css.photo} />
            ) : (
              <span aria-hidden="true" className={css.mono}>{cardMonogram(m)}</span>
            )}
            <span className={css.badge}>{badge(m.role.en)}</span>
          </div>
          <h1 className={css.name}>{m.name}</h1>
          {/* no truncation: "Chief Commercial Officer / CCO" wraps at 320px */}
          <p className={css.role}>{t(m.role)}</p>
          <p className={css.company}>{SITE_CONFIG.name} · {t(m.known)}</p>
        </header>

        {/* ---- the actions ---- */}
        <div className={css.actions}>
          {/* The headline feature: a real vCard, not a picture of a card. */}
          <a href={`/cards/${m.slug}.vcf`} download={`${m.slug}-a2z.vcf`} className={css.save}>
            <UserPlus aria-hidden="true" />
            {t(CARD_COPY.save)}
          </a>
          <a href={waHref} target="_blank" rel="noopener noreferrer" className={css.wa}>
            <MessageCircle aria-hidden="true" />
            {t(CARD_COPY.whatsapp)}
          </a>
          <ul className={css.icons}>
            <li><a href={`tel:${m.mobileE164}`}><span><Phone aria-hidden="true" /></span>{t(CARD_COPY.call)}</a></li>
            <li><a href={`mailto:${m.email}`}><span><Mail aria-hidden="true" /></span>{t(CARD_COPY.email)}</a></li>
            <li><Link href="/"><span><Globe aria-hidden="true" /></span>{t(CARD_COPY.website)}</Link></li>
            <li><a href={MAP_URL} target="_blank" rel="noopener noreferrer"><span><MapPin aria-hidden="true" /></span>{t(CARD_COPY.location)}</a></li>
          </ul>
          <button type="button" className={css.share} onClick={(e) => void share(e)}>
            <Share2 aria-hidden="true" />
            <span data-label aria-live="polite">{t(CARD_COPY.share)}</span>
          </button>
        </div>

        {/* ---- the body ---- */}
        <div className={css.body}>
          <section>
            <h2 className={css.h2}>{t(CARD_COPY.about)}</h2>
            <p className={css.lead}>{t(m.lead)}</p>
          </section>

          <section>
            <h2 className={css.h2}>{t(CARD_COPY.responsibilities)}</h2>
            <ul className={css.duties}>
              {duties.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </section>

          {/* Everything printed on the paper, label above value, values wrap. */}
          <section>
            <h2 className={css.h2}>{t(CARD_COPY.direct)}</h2>
            <dl className={css.contacts}>
              <div>
                <dt>{t(CARD_COPY.mobile)}</dt>
                <dd><a href={`tel:${m.mobileE164}`}>{m.mobile}</a></dd>
              </div>
              <div>
                <dt>{t(CARD_COPY.emailLabel)}</dt>
                <dd><a href={`mailto:${m.email}`}>{m.email}</a></dd>
              </div>
              <div>
                <dt>{t(CARD_COPY.office)}</dt>
                <dd><a href={`mailto:${CARD_COMPANY.email}`}>{CARD_COMPANY.email}</a></dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className={css.h2}>{t(CARD_COPY.visit)}</h2>
            {/* the address that prints on every invoice; not translated */}
            <a href={MAP_URL} target="_blank" rel="noopener noreferrer" className={css.address}>
              <MapPin aria-hidden="true" />
              <span>{SITE_CONFIG.address}</span>
            </a>
          </section>

          <section>
            <h2 className={css.h2}>{t(CARD_COPY.elsewhere)}</h2>
            <ul className={css.links}>
              {CARD_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>
                    <strong>{t(l.label)}</strong>
                    <span>{t(l.note)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* For when the cards run out: show the screen, let them scan it. */}
          <section className={css.qr}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/cards/${m.slug}-qr.png`} alt={`${t(CARD_COPY.qrAlt)} ${cardUrl}`} width={180} height={180} />
            <p>{t(CARD_COPY.outOfCards)}</p>
            <p className={css.url}>{cardUrl.replace("https://", "")}</p>
          </section>

          <footer className={css.foot}>
            {/* legal identification and the brand line are not translated */}
            <p>{SITE_CONFIG.legalName}</p>
            <p>{SITE_CONFIG.brandTagline}</p>
          </footer>
        </div>
      </article>
    </main>
  );
}
