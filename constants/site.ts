import type { NavItem } from "@/types";

export const SITE_CONFIG = {
  name: "AZ ONE OFFICIAL",
  legalName: "AZ One Official (JM1046169-H)",
  tagline: "Malaysia's Premium Live Commerce Agency",
  description:
    "AZ ONE OFFICIAL is a Malaysian live commerce agency helping brands grow through TikTok Live hosting, live commerce management, and social commerce strategy. Home of ELFIA, our premium fashion brand.",
  url: "https://azoneofficial.com",
  locale: "en_MY",
  brand: {
    fashion: "ELFIA",
  },
} as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "About", href: "#about" },
  { label: "Services", href: "#services" },
  { label: "Showcase", href: "#showcase" },
  { label: "ELFIA", href: "#elfia" },
  { label: "Process", href: "#process" },
  { label: "FAQ", href: "#faq" },
] as const;

export const CTA_LABEL = "Book a consultation" as const;
