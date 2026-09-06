"use client";

/**
 * v1.128.0 — the digital business card's body, bilingual.
 *
 * CEO, 06-09-2026: a BM/EN switcher on /farhan, /zoll and /izz, defaulting to
 * BM, switching without a page reload, holding the choice while the visitor
 * moves around the card, and translating everything a client can read.
 *
 * WHY THIS COMPONENT EXISTS AT ALL
 * The page above it stays a SERVER component: it owns generateStaticParams,
 * generateMetadata and the schema.org block, none of which can live in a
 * component that holds state. Only the readable body moved here, so the card
 * is still a file on a CDN with one small script on it — which was the whole
 * argument of v1.71.0 and is not given up for a toggle.
 *
 * NO FLASH, AND NO HYDRATION MISMATCH
 * The initial render is BM on both sides — server HTML and first client
 * render — so React hydrates against exactly what it sent, and the default
 * visitor never sees a language change. Only a visitor who previously chose
 * EN sees one repaint, in useEffect, after mount. That is the honest way
 * round: the common case is silent, the deliberate case costs a frame.
 *
 * ONE LANGUAGE PREFERENCE PER DEVICE
 * The site has had an EN/BM toggle since v1.32.0 (components/live/
 * lang-runtime.tsx), stored under `azone-lang` and broadcast on
 * `azone-lang-change`. The card reads and writes the SAME key and fires the
 * SAME event, so a visitor who switches here and then taps through to
 * /services stays in Malay, and the navbar's own toggle stays in step. A
 * second, private preference would have been two switchers disagreeing on
 * one site.
 *
 * BUT NOT the same MECHANISM. That runtime translates by walking text nodes
 * and matching rendered English against a dictionary — right for twelve
 * marketing pages, wrong for a page whose every string is known at build
 * time. So the card carries `data-no-translate`, which that runtime already
 * honours, and renders from typed pairs instead. Two mechanisms editing the
 * same text nodes is how half-Malay sentences happen.
 *
 * DEFAULT BM, WITHOUT OVERRIDING A CHOICE
 * "Default" means the untouched state. Nothing stored (a client opening the
 * link off a card for the first time — the case this page exists for) reads
 * as BM. An explicit earlier choice of English is honoured, because that was
 * a person telling us something.
 */

import { Mail, MapPin, MessageCircle, Phone, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CARD_COPY, CARD_LINKS, pick, type CardLang } from "@/constants/card-copy";
import { SITE_CONFIG } from "@/constants/site";
import { CARD_COMPANY, cardMonogram, type TeamCard } from "@/constants/team";

/** The same storage key and event the site-wide toggle uses (v1.32.0). */
const KEY = "azone-lang";
const EVENT = "azone-lang-change";

const MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  SITE_CONFIG.address,
)}`;

/** The three action buttons under the name share one look. */
const ACTION =
  "flex h-12 items-center justify-center gap-2 rounded-lg border border-white/20 text-sm font-medium text-white transition-colors hover:bg-white/10";

function LangSwitch({ lang, onChange }: { lang: CardLang; onChange: (l: CardLang) => void }) {
  /* A segmented pair, not a single button that toggles: a visitor has to be
     able to see WHICH language is on without pressing it to find out. Gold on
     navy for the active half is the card's own accent doing the work, so the
     control needs no colour of its own.

     `role="group"` with two real buttons and aria-pressed, rather than a
     radiogroup: these are actions with an immediate effect, not a form field
     somebody submits. Each is 44px wide and 28px tall — comfortably tappable
     without becoming a feature of the header. */
  const on = "bg-gold text-black";
  const off = "text-white/70 hover:text-white";
  return (
    <div
      role="group"
      aria-label={`${CARD_COPY.langLabel.ms} / ${CARD_COPY.langLabel.en}`}
      className="flex shrink-0 items-center rounded-full border border-white/20 p-0.5 text-[11px] font-semibold"
    >
      <button
        type="button"
        lang="ms"
        aria-pressed={lang === "ms"}
        onClick={() => onChange("ms")}
        className={`rounded-full px-2.5 py-1 transition-colors ${lang === "ms" ? on : off}`}
      >
        BM
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={lang === "en"}
        onClick={() => onChange("en")}
        className={`rounded-full px-2.5 py-1 transition-colors ${lang === "en" ? on : off}`}
      >
        EN
      </button>
    </div>
  );
}

export function CardView({ m }: { m: TeamCard }) {
  /* BM on the server AND on the first client render — see the header note. */
  const [lang, setLang] = useState<CardLang>("ms");

  useEffect(() => {
    /* An explicit earlier choice of English is the only thing that moves the
       card off its default. Anything else — nothing stored, "ms", a private
       window that throws on read — leaves it in Malay. */
    try {
      if (window.localStorage.getItem(KEY) === "en") setLang("en");
    } catch {
      /* private mode: the default stands, which is the right one anyway */
    }
    /* Keep in step if the choice changes elsewhere in the tab (the navbar's
       toggle on a page the visitor came from, or another card in the same
       session). */
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
    /* Persist and broadcast: the rest of the site listens on this event, and
       the choice has to survive tapping through to /services and back. */
    try {
      window.localStorage.setItem(KEY, next);
      window.dispatchEvent(new Event(EVENT));
    } catch { /* private mode: the card still switched, it just will not stick */ }
    document.documentElement.lang = next === "ms" ? "ms" : "en";
  }, []);

  const t = (v: { en: string; ms: string }) => pick(v, lang);
  const cardUrl = `${SITE_CONFIG.url}/${m.slug}`;
  const waHref = `https://wa.me/${m.mobileE164.replace(/[^0-9]/g, "")}`;
  const duties = m.duties[lang];

  return (
    /* data-no-translate: the site-wide BM runtime skips this subtree, because
       the card translates itself properly. */
    <main data-no-translate className="bg-background text-foreground min-h-screen">
      {/* The card face. Navy and gold, the same object as the paper. */}
      <header className="bg-brand text-white">
        <div className="mx-auto w-full max-w-xl px-6 pt-8 pb-10 sm:pt-12">
          {/* The switcher sits on the eyebrow line: top-right, level with the
              company name, so it costs the card no vertical space at all. */}
          {/* items-start, and the eyebrow WRAPS rather than truncating. At
              320px the company name in 11px/0.3em tracking is ~215px and the
              switcher ~76px, which does not fit the 272px between the page
              gutters — measured, not guessed. Truncating it turned "A2Z
              CREATIVE MARKETING" into an ellipsis on the smallest phones,
              which is the company's name on the first line of its own card.
              Two lines is the right answer; the switcher stays level with the
              first one. */}
          <div className="flex items-start justify-between gap-3">
            <Link
              href="/"
              className="text-gold min-w-0 text-[11px] leading-5 font-medium tracking-[0.3em] uppercase"
            >
              {SITE_CONFIG.name}
            </Link>
            <LangSwitch lang={lang} onChange={choose} />
          </div>

          <div className="mt-8 flex items-center gap-5">
            {m.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.photo}
                alt={m.name}
                className="border-gold/40 h-20 w-20 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="border-gold/40 text-gold flex h-20 w-20 shrink-0 items-center justify-center rounded-full border text-2xl font-semibold tracking-wide"
              >
                {cardMonogram(m)}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
                {m.name}
              </h1>
              {/* text-balance and no truncation: "Chief Commercial Officer /
                  CCO" is 30 characters, and on a 320px screen beside a 80px
                  photo it needs two lines rather than an ellipsis. */}
              <p className="text-gold mt-2 text-sm font-medium text-balance">{t(m.role)}</p>
              <p className="mt-1 text-sm text-white/60">{t(m.known)}</p>
            </div>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-white/70">{t(m.lead)}</p>

          {/* The headline feature: a real vCard, not a picture of a card. */}
          <a
            href={`/cards/${m.slug}.vcf`}
            download={`${m.slug}-a2z.vcf`}
            className="bg-gold focus-visible:outline-gold hover:bg-gold/85 mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium text-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t(CARD_COPY.save)}
          </a>

          {/* Three across on every width. "Telefon bimbit" never appears here
              — the buttons take the short BM verbs, which fit the same grid
              the English ones do. */}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <a href={`tel:${m.mobileE164}`} className={ACTION}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              {t(CARD_COPY.call)}
            </a>
            <a href={waHref} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t(CARD_COPY.whatsapp)}
            </a>
            <a href={`mailto:${m.email}`} className={ACTION}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t(CARD_COPY.email)}
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-6 py-12">
        {/* v1.128.0 — what this person owns, between who they are and how to
            reach them: the order a client actually reads a card in. */}
        <section>
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            {t(CARD_COPY.responsibilities)}
          </h2>
          <ul className="border-border divide-border mt-4 divide-y rounded-xl border">
            {duties.map((d) => (
              <li key={d} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden="true" className="bg-gold mt-2 h-1 w-1 shrink-0 rounded-full" />
                <span className="text-sm leading-relaxed">{d}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Everything printed on the paper, in the same order it is read. */}
        <section className="mt-10">
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            {t(CARD_COPY.direct)}
          </h2>
          {/* Label above value, and the value wraps. A long address on one line
              with the label beside it truncated izzudin.amdan@... on a phone,
              which is a contact detail the page exists to hand over. */}
          <dl className="border-border divide-border mt-4 divide-y rounded-xl border">
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">{t(CARD_COPY.mobile)}</dt>
              <dd>
                <a href={`tel:${m.mobileE164}`} className="text-sm font-medium">
                  {m.mobile}
                </a>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">{t(CARD_COPY.emailLabel)}</dt>
              <dd>
                <a href={`mailto:${m.email}`} className="text-sm font-medium break-all">
                  {m.email}
                </a>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">{t(CARD_COPY.office)}</dt>
              <dd>
                <a href={`mailto:${CARD_COMPANY.email}`} className="text-sm font-medium break-all">
                  {CARD_COMPANY.email}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            {t(CARD_COPY.visit)}
          </h2>
          <a
            href={MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border mt-4 flex items-start gap-3 rounded-xl border px-4 py-4"
          >
            <MapPin className="text-gold-deep mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {/* One source of truth: this is the address that prints on every
                invoice this company issues (lib/issuers.ts feeds it). An
                address is not translated — a courier has to read it. */}
            <span className="text-sm leading-relaxed">{SITE_CONFIG.address}</span>
          </a>
        </section>

        <section className="mt-10">
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            {t(CARD_COPY.elsewhere)}
          </h2>
          <ul className="border-border divide-border mt-4 divide-y rounded-xl border">
            {CARD_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="text-sm font-medium">{t(l.label)}</span>
                  <span className="text-muted-foreground text-xs">{t(l.note)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* For when the cards run out: show the screen, let them scan it. */}
        <section className="mt-10 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/cards/${m.slug}-qr.png`}
            alt={`${t(CARD_COPY.qrAlt)} ${cardUrl}`}
            width={180}
            height={180}
            className="border-border mx-auto h-[180px] w-[180px] rounded-xl border bg-white p-3"
          />
          <p className="text-muted-foreground mt-3 text-xs">{t(CARD_COPY.outOfCards)}</p>
          <p className="mt-1 text-xs font-medium">{cardUrl.replace("https://", "")}</p>
        </section>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-center text-xs">
          {/* The registered name and the brand line are legal identification
              and a brand asset. Neither is translated, for the same reason the
              letterheads are English-only (lib/issuers.ts). */}
          <p>{SITE_CONFIG.legalName}</p>
          <p className="mt-1">{SITE_CONFIG.brandTagline}</p>
        </footer>
      </div>
    </main>
  );
}
