import type { Metadata, Viewport } from "next";
import { CmsProvider } from "@azone/cms";
import {
  buildMetadata,
  buildViewport,
  organizationJsonLd,
} from "@azone/seo";

import { CMS_SITE, SEO } from "@/constants/seo";
import { whatsappUrl } from "@/constants/content";
import { ScrollMemory, ScrollToTop, WhatsAppFab } from "@azone/ui";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";

import { SITE_CONFIG } from "@/constants/site";
import "@/styles/globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = buildMetadata(SEO);

interface RootLayoutProps {
  children: ReactNode;
}

const jsonLd = organizationJsonLd({
  seo: SEO,
  legalName: "AZ ONE OFFICIAL (202603168673 / JM1046169-H)",
  logo: "/logo.png",
  address: {
    streetAddress: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika",
    addressLocality: "Johor Bahru",
    addressRegion: "Johor",
    postalCode: "81200",
    addressCountry: "MY",
  },
});

export const viewport: Viewport = buildViewport(SEO);

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        {/*
          Scroll behaviour:
           - Refresh / direct load  -> start at the top of the page
           - Back / forward         -> keep the browser's restored position, so
                                       returning from an ELFIA product lands
                                       back on the ELFIA section
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
            __html: JSON.stringify(jsonLd),
          }}
        />
        {SITE_CONFIG.cfAnalyticsToken && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: SITE_CONFIG.cfAnalyticsToken })}
          />
        )}
        <CmsProvider config={{ site: CMS_SITE }}>{children}</CmsProvider>
        <ScrollMemory />
        <WhatsAppFab href={whatsappUrl()} />
        <ScrollToTop />
      </body>
    </html>
  );
}
