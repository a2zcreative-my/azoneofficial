/**
 * v1.71.0 — the people behind the printed business cards (Track V).
 *
 * ONE record per person, and it is the only place any of this is written.
 * The card page, the `.vcf`, the QR target, the sitemap entry and the
 * Open Graph image all read from here, and `tests/business-cards.mjs`
 * fails the build if the committed `.vcf` files drift from these fields.
 *
 * WHY THIS IS A FILE AND NOT A TABLE
 * A card is printed on paper and handed to a stranger, so the URL on it has
 * to resolve on a bad day. The marketing site is a static export on
 * Cloudflare Pages; the API worker is a separate deploy that has been stuck
 * behind a broken build connection for weeks. Putting the one URL a client
 * types after meeting you behind that is the wrong risk. So: three records,
 * rendered at build time, no database and no runtime. Adding a person is a
 * deploy — for three directors that is the right trade.
 *
 * The shape is deliberately the shape a row would have, so the day this
 * becomes portal-managed the source changes and nothing above it moves.
 *
 * THE FIELDS ARE WHAT IS PRINTED. `name` and `mobile` are copied
 * character-for-character off the card, including the local `012-` form of
 * the number, because a client comparing the page against the paper in
 * their hand must see the same thing. `mobileE164` is the machine form used
 * for tel:, wa.me and the vCard — never shown.
 *
 * ---------------------------------------------------------------------------
 * v1.128.0 — BILINGUAL (CEO, 06-09-2026: a BM/EN switcher on all three cards,
 * with copy he wrote himself for both languages).
 *
 * Every field a client READS is a `Bilingual` pair; every field a machine uses
 * (slug, email, numbers, photo) stays a single string, because a phone number
 * has no language. The pair IS the translation mechanism for a person — there
 * is no dictionary to keep in step and no key to mistype, so a translation
 * cannot silently go missing: TypeScript will not compile a record with one
 * half filled in.
 *
 * MALAY IS THE DEFAULT, and the copy is not machine-translated. The CEO wrote
 * both versions; in two places they say slightly different things because
 * that is what reads naturally in each language. Do not "align" them.
 *
 * THE ONE-STRING ARTEFACTS. A vCard carries one TITLE and the Open Graph
 * image is one picture; neither can switch. Both take the BM (CEO's decision,
 * 06-09-2026), which is what the card itself opens in.
 */

/** A string a client reads, in both languages the cards are published in. */
export interface Bilingual {
  /** English. */
  readonly en: string;
  /** Bahasa Melayu — the default the cards open in. */
  readonly ms: string;
}

/** The same, for a list (the responsibilities block). */
export interface BilingualList {
  readonly en: readonly string[];
  readonly ms: readonly string[];
}

export interface TeamCard {
  /** The URL: a2zcreative.my/<slug>. Short, because it gets typed with a thumb. */
  slug: string;
  /** Exactly as printed on the card. A name is not translated. */
  name: string;
  /** How the person is addressed — "En. Farhan" / "Mr. Farhan". Also why the slug is what it is. */
  known: Bilingual;
  role: Bilingual;
  /**
   * Role URLs that redirect here (see public/_redirects). A person's URL
   * belongs to the person and follows them; a role URL belongs to the
   * company and stays with the chair.
   */
  roleSlugs: readonly string[];
  email: string;
  /** As printed. */
  mobile: string;
  /** Machine form: tel:, wa.me, vCard. */
  mobileE164: string;
  /**
   * Two letters for the disc when there is no photo. Explicit, not derived:
   * deriving it from `name` gives MOHD ALIF FARHAN the initials "MA", which
   * is nobody. It is a decision, so it is a field.
   */
  monogram: string;
  /**
   * Optional portrait under /public. Empty = the monogram is used, which is
   * the deliberate default: a card that ships beats a card waiting on a
   * photographer, and this is a field, not a redesign.
   */
  photo: string;
  /** The introduction, in the person's own voice. */
  lead: Bilingual;
  /** What this person owns. Four lines; the card lays them out as a list. */
  duties: BilingualList;
}

export const TEAM: readonly TeamCard[] = [
  {
    slug: "farhan",
    name: "MOHD ALIF FARHAN",
    known: { en: "Mr. Farhan", ms: "En. Farhan" },
    role: { en: "Managing Director / CEO", ms: "Pengarah Urusan / CEO" },
    roleSlugs: ["ceo"],
    email: "aliffarhan@a2zcreative.my",
    mobile: "012-2461823",
    mobileE164: "+60122461823",
    monogram: "AF",
    photo: "/cards/farhan.jpg",
    lead: {
      en: "Mr. Farhan leads A2Z Creative Marketing across company direction, business growth and client partnerships. He also oversees the development of AZ ONE OFFICIAL and the growth of ELFIA as a premium lifestyle brand.",
      ms: "En. Farhan menerajui A2Z Creative Marketing dalam menetapkan hala tuju syarikat, mengembangkan perniagaan dan membina hubungan bersama klien. Beliau turut memimpin pembangunan AZ ONE OFFICIAL serta mengembangkan ELFIA sebagai jenama gaya hidup premium.",
    },
    duties: {
      en: [
        "Company strategy, growth & direction",
        "Brand development for A2Z Creative Marketing & AZ ONE OFFICIAL",
        "Live commerce operations",
        "Client relationships & business development",
      ],
      ms: [
        "Strategi, pertumbuhan & hala tuju syarikat",
        "Pembangunan jenama A2Z Creative Marketing & AZ ONE OFFICIAL",
        "Pengurusan operasi live commerce",
        "Hubungan klien & pembangunan perniagaan",
      ],
    },
  },
  {
    slug: "izz",
    name: "MOHAMAD IZZUDIN",
    known: { en: "Mr. Izz", ms: "En. Izz" },
    role: { en: "Chief Commercial Officer / CCO", ms: "Ketua Komersial / CCO" },
    roleSlugs: ["cco"],
    email: "izzudin.amdan@a2zcreative.my",
    mobile: "012-7087920",
    mobileE164: "+60127087920",
    monogram: "IZ",
    photo: "/cards/izz.jpg",
    lead: {
      en: "Mr. Izz leads the commercial growth of A2Z Creative Marketing, focusing on client relationships, business development, sales opportunities and strategic partnerships.",
      ms: "En. Izz mengurus pembangunan komersial A2Z Creative Marketing, termasuk hubungan klien, peluang perniagaan dan strategi jualan. Beliau memastikan setiap peluang diterokai dengan baik bagi membantu mengembangkan perniagaan dan membina kerjasama jangka panjang.",
    },
    duties: {
      en: [
        "Business development & commercial strategy",
        "Client relationships & strategic partnerships",
        "Sales opportunities & revenue growth",
        "Client needs & proposal coordination",
      ],
      ms: [
        "Pembangunan perniagaan & strategi komersial",
        "Hubungan klien & kerjasama strategik",
        "Peluang jualan & pertumbuhan hasil",
        "Penyelarasan tawaran dan keperluan klien",
      ],
    },
  },
  {
    slug: "zoll",
    name: "ZOLKEFLI",
    known: { en: "Mr. Zoll", ms: "En. Zoll" },
    role: { en: "Chief Operating Officer / COO", ms: "Ketua Operasi / COO" },
    roleSlugs: ["coo"],
    email: "zolkefli@a2zcreative.my",
    mobile: "014-3569293",
    mobileE164: "+60143569293",
    monogram: "ZO",
    photo: "/cards/zoll.jpg",
    lead: {
      en: "Mr. Zoll leads A2Z Creative Marketing's day-to-day operations, coordinating live schedules, studio and hosts to ensure every session and campaign runs smoothly and according to plan.",
      ms: "En. Zoll mengurus operasi harian A2Z Creative Marketing, termasuk penyelarasan jadual live, studio dan pasukan hos. Beliau memastikan setiap sesi live dan kempen berjalan lancar, teratur dan mengikut perancangan.",
    },
    duties: {
      en: [
        "Daily operations & execution",
        "Live, studio & host scheduling",
        "Order & fulfilment coordination",
        "Ensuring smooth campaign execution",
      ],
      ms: [
        "Operasi & pelaksanaan harian",
        "Penyelarasan jadual live, studio & hos",
        "Pengurusan pesanan & penghantaran",
        "Memastikan setiap kempen berjalan lancar",
      ],
    },
  },
] as const;

/**
 * The company line on every card. `hello@` is the shared inbox printed on
 * the paper; a client often wants the company rather than the person.
 */
export const CARD_COMPANY = {
  email: "hello@a2zcreative.my",
} as const;

export function cardBySlug(slug: string): TeamCard | undefined {
  return TEAM.find((m) => m.slug === slug);
}

/**
 * What goes on the disc when there is no photo: the chosen monogram, or a
 * derived one if a new record has not chosen yet. Never empty, because an
 * empty disc on the first thing a client sees reads as a broken page.
 */
export function cardMonogram(m: TeamCard): string {
  if (m.monogram.trim()) return m.monogram.trim().toUpperCase();
  return m.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}
