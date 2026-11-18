import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServicePage } from "@/components/landing/service-page";
import { SERVICE_PAGES, serviceBySlug } from "@/constants/services";

/* Website restructure (18-11-2026, unreleased) - the eight service pages in Bahasa Melayu, built at export time,
   each paired with its English page by hreflang. */
export const dynamicParams = false;

export function generateStaticParams() {
  return SERVICE_PAGES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = serviceBySlug((await params).slug);
  if (!s) return {};
  const c = s.ms;
  const en = `/services/${s.slug}`;
  const path = `/ms${en}`;
  return {
    title: { absolute: `${c.seoTitle} | A2Z` },
    description: c.seoDescription,
    alternates: {
      canonical: path,
      languages: { "en-MY": en, "ms-MY": path, "x-default": en },
    },
    openGraph: { title: c.seoTitle, description: c.seoDescription, url: path, locale: "ms_MY", alternateLocale: ["en_MY"] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const s = serviceBySlug((await params).slug);
  if (!s) notFound();
  return <ServicePage s={s} lang="ms" />;
}
