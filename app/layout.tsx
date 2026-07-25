import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";

import { ScrollToTop } from "@/components/ui/scroll-to-top";
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
  title: {
    default: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    template: `%s — ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  keywords: [
    "live commerce agency Malaysia",
    "TikTok Live hosting Malaysia",
    "live commerce management",
    "social commerce strategy",
    "ELFIA fashion",
  ],
  openGraph: {
    type: "website",
    url: SITE_CONFIG.url,
    siteName: SITE_CONFIG.name,
    title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    locale: SITE_CONFIG.locale,
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "AZ ONE OFFICIAL — Live . Connect . Grow" },
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

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_CONFIG.name,
  legalName: SITE_CONFIG.legalName,
  url: SITE_CONFIG.url,
  slogan: SITE_CONFIG.slogan,
  address: {
    "@type": "PostalAddress",
    streetAddress: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika",
    addressLocality: "Johor Bahru",
    addressRegion: "Johor",
    postalCode: "81200",
    addressCountry: "MY",
  },
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
      <body>
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
        <ScrollToTop />
      </body>
    </html>
  );
}
