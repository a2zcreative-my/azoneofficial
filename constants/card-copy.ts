/**
 * v1.128.0 — the CARD's own wording, in both languages.
 *
 * constants/team.ts holds what is true about a PERSON (their role, their
 * introduction, what they own). This file holds what is true about the CARD:
 * the section headings, the buttons, the contact labels, the links out and
 * the footer. Two files because they change for different reasons and by
 * different people — a director's responsibilities move when the job moves;
 * "Save to contacts" moves when the card is redesigned.
 *
 * NOT A DICTIONARY. The public site already has one (constants/ms.ts), which
 * translates by matching rendered English text — the right tool for twelve
 * marketing pages that would otherwise all have to be split in half. It is
 * the wrong tool here: a card is one small page whose every string is known
 * at build time, and a key/value pair is checked by the compiler where a
 * text match fails silently the day somebody rewords a heading.
 *
 * The card is therefore marked `data-no-translate` (see card-view.tsx) so the
 * site-wide runtime does not also walk it. Two mechanisms editing the same
 * text nodes is how you get half-Malay sentences.
 *
 * WRITTEN, NOT TRANSLATED. "Simpan ke kenalan" is what a Malaysian phone
 * says, not a rendering of "Save to contacts". Where a natural BM phrase is
 * longer than the English, the layout below was checked at 320px rather than
 * the phrase shortened to fit.
 */

import type { Bilingual } from "@/constants/team";

export type CardLang = "en" | "ms";

/** Everything on the card that is not the person. */
export const CARD_COPY = {
  /* --- the switcher itself --- */
  langLabel: { en: "Language", ms: "Bahasa" },

  /* --- the actions, in order of how often they are used --- */
  save: { en: "Save to contacts", ms: "Simpan ke kenalan" },
  call: { en: "Call", ms: "Telefon" },
  whatsapp: { en: "WhatsApp", ms: "WhatsApp" }, // a brand name, the same in both
  email: { en: "Email", ms: "E-mel" },

  /* --- section headings --- */
  responsibilities: { en: "Responsibilities", ms: "Tanggungjawab" },
  direct: { en: "Direct", ms: "Hubungi terus" },
  visit: { en: "Visit", ms: "Lawati" },
  elsewhere: { en: "A2Z Creative Marketing", ms: "A2Z Creative Marketing" }, // the company name is the company name

  /* --- contact labels --- */
  mobile: { en: "Mobile", ms: "Telefon bimbit" },
  emailLabel: { en: "Email", ms: "E-mel" },
  office: { en: "Office", ms: "Pejabat" },

  /* --- the QR block --- */
  qrAlt: { en: "QR code for", ms: "Kod QR untuk" },
  outOfCards: { en: "Out of cards? Show this.", ms: "Kad habis? Tunjukkan ini." },
} as const satisfies Record<string, Bilingual>;

/** The links out of the card, at the foot of the page. */
export const CARD_LINKS: readonly {
  href: string;
  label: Bilingual;
  note: Bilingual;
}[] = [
  {
    href: "/services",
    label: { en: "What we do", ms: "Perkhidmatan kami" },
    note: {
      en: "Creative, digital and live commerce",
      ms: "Kreatif, digital dan live commerce",
    },
  },
  {
    href: "/packages",
    label: { en: "Packages", ms: "Pakej" },
    note: {
      en: "Where most clients start",
      ms: "Permulaan bagi kebanyakan klien",
    },
  },
  {
    href: "/portfolio",
    label: { en: "Work", ms: "Hasil kerja" },
    note: {
      en: "Campaigns and live sessions",
      ms: "Kempen dan sesi live",
    },
  },
  {
    href: "/contact",
    label: { en: "Contact the office", ms: "Hubungi pejabat" },
    note: {
      en: "Enquiries, quotes, visits",
      ms: "Pertanyaan, sebut harga, lawatan",
    },
  },
] as const;

/** Pick a language out of any bilingual pair. The one accessor on the card. */
export const pick = (v: Bilingual, lang: CardLang): string => v[lang];
