import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import { buildSitemap } from "@azone/seo";

import { COLLECTIONS, JOURNAL_POSTS, PRODUCTS } from "@/constants/catalogue";
import { SEO } from "@/constants/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...buildSitemap(SEO, ["", "/collections", "/products", "/live", "/journal", "/contact"]),
    ...buildSitemap(SEO, COLLECTIONS.map((c) => `/collections/${c.slug}`)),
    ...buildSitemap(SEO, PRODUCTS.map((p) => `/products/${p.slug}`)),
    ...buildSitemap(SEO, JOURNAL_POSTS.map((p) => `/journal/${p.slug}`)),
  ];
}
