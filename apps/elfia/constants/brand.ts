/**
 * ELFIA brand configuration.
 *
 * ELFIA is an independent brand and a client of AZ ONE OFFICIAL. Nothing here
 * should depend on the agency app — the only relationship expressed on this
 * site is the "Powered by AZ ONE OFFICIAL" line in the footer.
 */
export const BRAND = {
  name: "ELFIA",
  legalName: "ELFIA",
  url: "https://elfia.com.my",
  /** Malay slogan leads — it is the brand's own voice. */
  slogan: "Dekat Di Mata, Menarik Di Hati",
  /** Its meaning in English, always shown as a pair with the slogan. */
  strapline: "At First Sight. Forever in Your Heart.",
  description:
    "ELFIA — premium chiffon hijabs in essential neutrals, designed in Malaysia for office, everyday, and active wear. Every drop launches live.",
  locale: "en_MY",
  whatsapp: "60123834821",
  whatsappMessage: "Hi ELFIA, I'd like to ask about a piece.",
  email: "hello@elfia.com.my",
  socials: {
    tiktok: "https://www.tiktok.com/@elfia.official",
    instagram: "https://www.instagram.com/elfia.official",
  },
  poweredBy: {
    label: "Powered by AZ ONE OFFICIAL",
    href: "https://azoneofficial.com",
  },
} as const;

export function whatsappUrl(message?: string): string {
  const text = encodeURIComponent(message ?? BRAND.whatsappMessage);
  return `https://wa.me/${BRAND.whatsapp}?text=${text}`;
}

export const NAV_ITEMS = [
  { label: "Collections", href: "/collections" },
  { label: "Shawls", href: "/products" },
  { label: "Live", href: "/live" },
  { label: "Journal", href: "/journal" },
  { label: "Contact", href: "/contact" },
] as const;
