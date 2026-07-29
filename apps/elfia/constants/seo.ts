import type { SiteSeo } from "@azone/seo";

import { BRAND } from "./brand";

export const SEO: SiteSeo = {
  name: BRAND.name,
  url: BRAND.url,
  tagline: BRAND.slogan,
  description: BRAND.description,
  locale: BRAND.locale,
  ogImage: "/og.png",
  ogImageAlt: "ELFIA — Dekat Di Mata, Menarik Di Hati",
  themeColor: "#3f3730",
  keywords: [
    "hijab Malaysia",
    "premium chiffon shawl",
    "tudung bawal",
    "shawl neutral",
    "hijab sukan",
    "ELFIA",
  ],
};

/** Tenant key on the shared API — keeps ELFIA content separate from the agency. */
export const CMS_SITE = "elfia";
