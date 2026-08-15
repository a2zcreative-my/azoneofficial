import type { NavItem } from "@/types";

export const SITE_CONFIG = {
  name: "AZ ONE OFFICIAL",
  legalName: "AZ One Official (JM1046169-H)",
  tagline: "Malaysia's Premium Live Commerce Agency",
  brandTagline: "Live . Connect . Grow.",
  slogan: "Empowering Brands Through Live Commerce and Digital Connections.",
  address:
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor, Malaysia",

  /* v1.16.1 — the office point, from the CEO (15 Aug 2026). ONE source of
     truth: the geofence card pre-fills from here, and anything else that
     needs HQ (ops map centring, distance display) must import this rather
     than repeat the numbers. Changing offices = edit this once. */
  office: {
    lat: 1.544418427439,
    lng: 103.71003343205108,
    label: "AZ ONE HQ",
    /** Default fence radius in metres — 120 m covers the lot + GPS drift. */
    radiusM: 120,
  },  description:
    "AZ ONE OFFICIAL is a Malaysian live commerce agency helping brands grow through TikTok Live hosting, live commerce management, and social commerce strategy. Featured client: ELFIA.",
  url: "https://azoneofficial.com",
  locale: "en_MY",
  /** Featured client, never "our brand" — the agency owns no product line. */
  featuredClient: "ELFIA",
  // Cloudflare Web Analytics token — Cloudflare dashboard → Analytics → Web Analytics
  // → Add a site → copy the token here. Leave "" to disable the beacon.
  cfAnalyticsToken: "",
} as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "About", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Packages", href: "/packages" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
] as const;

export const CTA_LABEL = "Get a free live audit" as const;
