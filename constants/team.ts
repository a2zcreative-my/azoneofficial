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
 */

export interface TeamCard {
  /** The URL: a2zcreative.my/<slug>. Short, because it gets typed with a thumb. */
  slug: string;
  /** Exactly as printed on the card. */
  name: string;
  /** How the person is actually addressed. This is also why the slug is what it is. */
  known: string;
  role: string;
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
  /** One line, in the person's own function. Edit freely — nothing derives from it. */
  lead: string;
}

export const TEAM: readonly TeamCard[] = [
  {
    slug: "farhan",
    name: "MOHD ALIF FARHAN",
    known: "En. Farhan",
    role: "Managing Director / CEO",
    roleSlugs: ["ceo"],
    email: "aliffarhan@a2zcreative.my",
    mobile: "012-2461823",
    mobileE164: "+60122461823",
    monogram: "AF",
    photo: "",
    lead: "Leads A2Z Creative Marketing — brand direction, live commerce, and the client partnerships behind both.",
  },
  {
    slug: "izz",
    name: "MOHAMAD IZZUDIN",
    known: "En. Izz",
    role: "Director / CCO",
    roleSlugs: ["cco"],
    email: "izzudin.amdan@a2zcreative.my",
    mobile: "012-7087920",
    mobileE164: "+60127087920",
    monogram: "IZ",
    photo: "",
    lead: "Creative direction across campaigns, content and the way the brands we work with are seen.",
  },
  {
    slug: "zoll",
    name: "ZOLKEFLI",
    known: "En. Zoll",
    role: "Director / COO",
    roleSlugs: ["coo"],
    email: "zolkefli@a2zcreative.my",
    mobile: "014-3569293",
    mobileE164: "+60143569293",
    monogram: "ZO",
    photo: "",
    lead: "Operations — live schedules, fulfilment and the day-to-day that keeps a campaign running.",
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
