import type { NavItem } from "@/types";

/**
 * v1.27.0 — the parent-company identity.
 *
 * A2Z CREATIVE MARKETING is the parent company and the public/marketing
 * identity of this site. AZ ONE OFFICIAL is no longer the parent: it is a
 * consultancy business unit under A2Z and a SEPARATE LEGAL ENTITY
 * (202603168673 / JM1046169-H). See /consultancy.
 *
 * Scope of this file: marketing identity ONLY. Legal documents (quotation,
 * invoice, official receipt, payslip, roster) deliberately stay AZ ONE
 * OFFICIAL and read their letterhead from lib/issuers.ts — never from here.
 * tests/document-issuer-guard.mjs enforces that separation.
 */
export const SITE_CONFIG = {
  name: "A2Z CREATIVE MARKETING",
  legalName: "A2Z Creative Marketing (202603003468 / CA0414729-A)",
  tagline: "Creative, Digital & Live Commerce Partners",
  /* Three-beat brand mark, replacing "Live . Connect . Grow." — that line
     belonged to the live-commerce identity, which is now one service line
     rather than the whole company. CEO: this is the one line to change if a
     different mark is preferred; nothing else depends on its wording. */
  brandTagline: "Creative . Digital . Commerce.",
  slogan:
    "Empowering brands through creative marketing, digital growth, and live commerce.",
  address:
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor, Malaysia",

  /* v1.16.1 — the office point, from the CEO (15 Aug 2026). ONE source of
     truth: the geofence card pre-fills from here, and anything else that
     needs HQ (ops map centring, distance display) must import this rather
     than repeat the numbers. Changing offices = edit this once. */
  office: {
    lat: 1.544418427439,
    lng: 103.71003343205108,
    /* v1.27.0 — deliberately still "AZ ONE HQ", and NOT renamed with the
       marketing identity. This string is only the pre-fill label for a NEW
       geofence; the live fence (name, centre, radius) is stored in the
       database, so editing it here does not move or rename an existing
       fence. Rename the fence in Admin if ops should read A2Z. */
    label: "AZ ONE HQ",
    /** Default fence radius in metres — 120 m covers the lot + GPS drift. */
    radiusM: 120,
  },
  description:
    "A2Z Creative Marketing is a Malaysian creative marketing group in Johor Bahru — creative and digital marketing, live commerce, content creation, marketing consultancy, business development, and product development for brands that want to grow.",
  /* The domain does NOT change with the rename. azoneofficial.com stays the
     canonical host until an A2Z domain is registered and redirected. */
  url: "https://azoneofficial.com",
  locale: "en_MY",
  // Cloudflare Web Analytics token — Cloudflare dashboard → Analytics → Web Analytics
  // → Add a site → copy the token here. Leave "" to disable the beacon.
  cfAnalyticsToken: "",
} as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "About", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Consultancy", href: "/consultancy" },
  { label: "Packages", href: "/packages" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
] as const;

export const CTA_LABEL = "Get a free live audit" as const;
