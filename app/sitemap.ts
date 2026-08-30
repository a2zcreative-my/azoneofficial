import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/constants/pages";
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

  return [...staticRoutes, ...cardRoutes, ...blogRoutes];
}
