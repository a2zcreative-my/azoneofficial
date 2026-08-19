import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";

import { PwaRegister } from "@/components/pwa-register";
import { OfflineBanner } from "@/components/ui/offline-banner";

import { ScrollMemory } from "@/components/ui/scroll-memory";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { WhatsAppFab } from "@/components/ui/whatsapp-fab";
import { SITE_CONFIG } from "@/constants/site";
import "@/styles/globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    /* Home-screen label. iOS truncates at roughly 12 characters, so this has
       to be the short mark, not the registered name. */
    title: "A2Z",
    statusBarStyle: "black-translucent",
  },
  title: {
    default: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    template: `%s — ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  /* Canonical for "/". Every page sets its own via `alternates.canonical`;
     Next resolves the relative path against metadataBase above. This exists
     so the index cannot fragment across query strings today, and so a future
     domain move is a one-line change to SITE_CONFIG.url rather than a
     site-wide retrofit. */
  alternates: { canonical: "/" },
  keywords: [
    "creative marketing agency Malaysia",
    "digital marketing agency Johor Bahru",
    "marketing consultancy Malaysia",
    "content creation Malaysia",
    "business development Malaysia",
    "product development Malaysia",
    "live commerce agency Malaysia",
    "TikTok Live hosting Malaysia",
    "live commerce management",
    "social commerce strategy",
  ],
  openGraph: {
    type: "website",
    url: SITE_CONFIG.url,
    siteName: SITE_CONFIG.name,
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    locale: SITE_CONFIG.locale,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

interface RootLayoutProps {
  children: ReactNode;
}

const POSTAL_ADDRESS = {
  "@type": "PostalAddress",
  streetAddress: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika",
  addressLocality: "Johor Bahru",
  addressRegion: "Johor",
  postalCode: "81200",
  addressCountry: "MY",
} as const;

/**
 * Organization graph (v1.27.0).
 *
 * A2Z CREATIVE MARKETING is the parent Organization; AZ ONE OFFICIAL is
 * declared as a subOrganization — a consultancy service, and its own
 * registered entity. `@id` values are anchored to the site URL so the two
 * nodes stay distinguishable if either ever gets its own domain.
 *
 * Clients are NEVER named here. Structured data is machine-readable and
 * permanently cached by search engines; a client relationship published this
 * way cannot be quietly withdrawn later.
 */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_CONFIG.url}/#organization`,
  name: SITE_CONFIG.name,
  legalName: SITE_CONFIG.legalName,
  url: SITE_CONFIG.url,
  slogan: SITE_CONFIG.slogan,
  description: SITE_CONFIG.description,
  address: POSTAL_ADDRESS,
  knowsAbout: [
    "Creative marketing",
    "Digital marketing",
    "Live commerce",
    "Content creation",
    "Marketing consultancy",
    "Business development",
    "Product development",
  ],
  subOrganization: [
    {
      "@type": "Organization",
      "@id": `${SITE_CONFIG.url}/consultancy#az-one-official`,
      name: "AZ ONE OFFICIAL",
      legalName: "AZ One Official (202603168673 / JM1046169-H)",
      url: `${SITE_CONFIG.url}/consultancy`,
      description:
        "AZ ONE OFFICIAL — A Consultancy Service by A2Z Creative Marketing. Business consultation, live commerce consultancy, and brand and channel strategy.",
      parentOrganization: { "@id": `${SITE_CONFIG.url}/#organization` },
      address: POSTAL_ADDRESS,
    },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a2946",
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={`${poppins.variable} bg-background text-foreground min-h-screen font-sans antialiased selection:bg-primary/20`}>
        <OfflineBanner />
        <PwaRegister />
        {/*
          Scroll behaviour:
           - Refresh / direct load  -> start at the top of the page
           - Back / forward         -> keep the browser's restored position, so
                                       returning from a linked page lands back
                                       on the section you left from
           - #anchor in the URL     -> left alone for the browser to handle
          This must run before first paint, otherwise the browser has already
          restored the old offset and jumping to the top would flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
  if(!('scrollRestoration' in history))return;
  var e=performance.getEntriesByType('navigation')[0];
  var t=e&&e.type;
  if(t==='reload'&&!location.hash){
    history.scrollRestoration='manual';
    document.documentElement.setAttribute('data-scroll-reset','1');
    window.addEventListener('load',function(){
      window.scrollTo(0,0);
      document.documentElement.removeAttribute('data-scroll-reset');
      history.scrollRestoration='auto';
    });
  }else if(t==='back_forward'){
    /* Back after a reload is a FULL document load, not an in-app popstate.
       The browser restores before layout finishes and clamps to a shorter
       document, dropping you at the wrong section. Take over only when we
       actually have a stored offset for this path; ScrollMemory applies it
       once the page is tall enough. */
    var m={};try{m=JSON.parse(sessionStorage.getItem('azo:scroll')||'{}');}catch(_){}
    if(m[location.pathname]>0){
      history.scrollRestoration='manual';
      document.documentElement.setAttribute('data-scroll-reset','1');
    }
  }
}catch(_){}})();`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        {SITE_CONFIG.cfAnalyticsToken && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: SITE_CONFIG.cfAnalyticsToken })}
          />
        )}
        {children}
        <ScrollMemory />
        <WhatsAppFab />
        <ScrollToTop />
      </body>
    </html>
  );
}
