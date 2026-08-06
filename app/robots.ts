import type { MetadataRoute } from "next";

import { SITE_CONFIG } from "@/constants/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/portal", "/login", "/account", "/doc"] }, // v1.4.244: customer document links stay out of search
    sitemap: `${SITE_CONFIG.url}/sitemap.xml`,
  };
}
