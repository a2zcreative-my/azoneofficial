import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import { buildSitemap } from "@azone/seo";

import { CASE_STUDIES } from "@/constants/content";
import { BLOG_POSTS } from "@/constants/pages";
import { SEO } from "@/constants/seo";

const STATIC_ROUTES = [
  "",
  "/about",
  "/services",
  "/packages",
  "/portfolio",
  "/case-studies",
  "/blog",
  "/careers",
  "/faq",
  "/contact",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...buildSitemap(SEO, STATIC_ROUTES),
    ...buildSitemap(
      SEO,
      CASE_STUDIES.map((study) => `/portfolio/${study.slug}`),
    ),
    ...buildSitemap(
      SEO,
      BLOG_POSTS.map((post) => `/blog/${post.slug}`),
    ),
  ];
}
