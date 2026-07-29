import type { Metadata, Viewport } from "next";

/**
 * Per-site SEO identity. Each app declares this once; the helpers below build
 * consistent metadata, JSON-LD, sitemaps and robots from it — so a new client
 * gets correct SEO by filling in one object rather than copying boilerplate.
 */
export interface SiteSeo {
  name: string;
  url: string;
  tagline: string;
  description: string;
  locale: string;
  ogImage: string;
  ogImageAlt: string;
  keywords?: readonly string[];
  themeColor: string;
  twitterHandle?: string;
}

/** Root metadata for an app's layout.tsx. */
export function buildMetadata(seo: SiteSeo): Metadata {
  return {
    metadataBase: new URL(seo.url),
    title: {
      default: `${seo.name} — ${seo.tagline}`,
      template: `%s | ${seo.name}`,
    },
    description: seo.description,
    keywords: seo.keywords ? [...seo.keywords] : undefined,
    openGraph: {
      type: "website",
      url: seo.url,
      siteName: seo.name,
      title: `${seo.name} — ${seo.tagline}`,
      description: seo.description,
      locale: seo.locale,
      // One landscape image only. Offering a square alternative lets WhatsApp
      // pick it and fall back to the compact preview card.
      images: [
        { url: seo.ogImage, width: 1200, height: 630, alt: seo.ogImageAlt },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${seo.name} — ${seo.tagline}`,
      description: seo.description,
      images: [seo.ogImage],
      site: seo.twitterHandle,
    },
    robots: { index: true, follow: true },
    alternates: { canonical: seo.url },
  };
}

export function buildViewport(seo: SiteSeo): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: seo.themeColor,
  };
}

export interface OrganizationInput {
  seo: SiteSeo;
  legalName?: string;
  logo: string;
  sameAs?: readonly string[];
  address?: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  /** Use "Organization" for an agency, "Brand" for a label. */
  type?: "Organization" | "Brand" | "LocalBusiness";
}

export function organizationJsonLd(input: OrganizationInput) {
  const { seo, type = "Organization" } = input;
  return {
    "@context": "https://schema.org",
    "@type": type,
    name: seo.name,
    legalName: input.legalName ?? seo.name,
    url: seo.url,
    logo: `${seo.url}${input.logo}`,
    description: seo.description,
    sameAs: input.sameAs ? [...input.sameAs] : undefined,
    address: input.address
      ? { "@type": "PostalAddress", ...input.address }
      : undefined,
  };
}

export function breadcrumbJsonLd(
  seo: SiteSeo,
  trail: readonly { name: string; path: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${seo.url}${item.path}`,
    })),
  };
}

/** Static sitemap entries for a set of routes. */
export function buildSitemap(seo: SiteSeo, routes: readonly string[]) {
  return routes.map((path) => ({
    url: `${seo.url}${path}`,
    lastModified: new Date(),
  }));
}

export function buildRobots(seo: SiteSeo) {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/portal", "/account"] },
    sitemap: `${seo.url}/sitemap.xml`,
  };
}
