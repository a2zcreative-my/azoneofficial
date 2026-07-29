import type { MetadataRoute } from "next";

export const dynamic = "force-static";

import { buildRobots } from "@azone/seo";

import { SEO } from "@/constants/seo";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(SEO);
}
