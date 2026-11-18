import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/constants/pages";
import { SERVICE_PAGES } from "@/constants/services";
import { SITE_CONFIG } from "@/constants/site";
import { TEAM } from "@/constants/team";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_CONFIG.url;
  const staticRoutes = [
    "",
    "/about",
    "/services",
    "/consultancy",
    "/packages",
    "/portfolio",
    "/case-studies",
    "/blog",
    "/careers",
    "/faq",
    "/contact",
    "/privacy",
    "/terms",
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
  }));

  const blogRoutes = BLOG_POSTS.map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(post.date),
  }));

  /* v1.71.0 — the digital business cards. A card page is reachable from
     a printed QR whether or not it is indexed, but a person who searches
     the name they were just given should find it too. */
  const cardRoutes = TEAM.map((m) => ({
    url: `${base}/${m.slug}`,
    lastModified: new Date(),
  }));

  /* Website restructure (18-11-2026, unreleased) - the homepage and the eight service pages exist in English and
     Bahasa Melayu; each entry names its twin (hreflang in the sitemap, the
     same pairs the pages declare in their own <head>). */
  const pair = (en: string, ms: string, priority: number) => {
    const languages = { "en-MY": `${base}${en}`, "ms-MY": `${base}${ms}` };
    return [
      { url: `${base}${en}`, lastModified: new Date(), priority, alternates: { languages } },
      { url: `${base}${ms}`, lastModified: new Date(), priority, alternates: { languages } },
    ];
  };
  const home = pair("", "/ms", 1);
  const services = SERVICE_PAGES.flatMap((s) => pair(`/services/${s.slug}`, `/ms/services/${s.slug}`, 0.9));

  return [...home, ...staticRoutes.filter((r) => r.url !== base), ...services, ...cardRoutes, ...blogRoutes];
}
