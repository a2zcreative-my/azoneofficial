import type { SiteSeo } from "@azone/seo";

import { SITE_CONFIG } from "./site";

/** SEO identity for azoneofficial.com. ELFIA declares its own in apps/elfia. */
export const SEO: SiteSeo = {
  name: SITE_CONFIG.name,
  url: SITE_CONFIG.url,
  tagline: SITE_CONFIG.tagline,
  description: SITE_CONFIG.description,
  locale: SITE_CONFIG.locale,
  ogImage: "/og.png",
  ogImageAlt: "AZ ONE OFFICIAL — Live . Connect . Grow",
  themeColor: "#1a2946",
  keywords: [
    "live commerce agency Malaysia",
    "TikTok Live agency",
    "Shopee Live agency",
    "live host service Malaysia",
    "live commerce strategy",
    "live operations",
    "performance marketing Malaysia",
  ],
};

/** Tenant key for the shared CMS/API. */
export const CMS_SITE = "azoneofficial";
