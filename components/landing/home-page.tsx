/* Website restructure (18-11-2026, unreleased) - the homepage in one language: Navbar, sections A-E, Footer (F).
   app/page.tsx renders it in English, app/ms/page.tsx in Bahasa Melayu.
   The BM version wraps its content in lang="ms" so browsers, screen readers
   and search engines read it as Malay (the root <html> stays lang="en",
   because the site has one root layout). */
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Consultation, Hero, SelectedWork, ServicesGrid, WhyA2z } from "@/components/landing/home-sections";
import { CONTACT } from "@/constants/content";
import { HOME_COPY } from "@/constants/home-copy";
import { SERVICE_PAGES, servicePath, type Lang } from "@/constants/services";
import { SITE_CONFIG } from "@/constants/site";

/** The local business, for search: only facts that are true and public. */
function localBusinessJsonLd(lang: Lang) {
  const url = `${SITE_CONFIG.url}${lang === "ms" ? "/ms" : "/"}`;
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${SITE_CONFIG.url}/#localbusiness`,
    name: SITE_CONFIG.name,
    legalName: SITE_CONFIG.legalName,
    url,
    image: `${SITE_CONFIG.url}/og.png`,
    logo: `${SITE_CONFIG.url}/logo.png`,
    description: HOME_COPY[lang].meta.description,
    telephone: `+${CONTACT.whatsapp}`,
    email: CONTACT.email,
    inLanguage: lang === "ms" ? "ms-MY" : "en-MY",
    address: {
      "@type": "PostalAddress",
      streetAddress: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika",
      addressLocality: "Johor Bahru",
      addressRegion: "Johor",
      postalCode: "81200",
      addressCountry: "MY",
    },
    geo: { "@type": "GeoCoordinates", latitude: SITE_CONFIG.office.lat, longitude: SITE_CONFIG.office.lng },
    areaServed: [
      { "@type": "City", name: "Johor Bahru" },
      { "@type": "State", name: "Johor" },
      { "@type": "Country", name: "Malaysia" },
    ],
    sameAs: Object.values(CONTACT.socials),
    parentOrganization: { "@id": `${SITE_CONFIG.url}/#organization` },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: lang === "ms" ? "Perkhidmatan" : "Services",
      itemListElement: SERVICE_PAGES.map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s[lang].name, url: `${SITE_CONFIG.url}${servicePath(s, lang)}` },
      })),
    },
  };
}

export function HomePage({ lang }: { lang: Lang }) {
  return (
    <>
      <Navbar />
      <main lang={lang === "ms" ? "ms" : undefined}>
        <Hero lang={lang} />
        <ServicesGrid lang={lang} />
        <SelectedWork lang={lang} />
        <WhyA2z lang={lang} />
        <Consultation lang={lang} />
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd(lang)) }}
      />
    </>
  );
}
