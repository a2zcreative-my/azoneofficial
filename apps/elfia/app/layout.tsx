import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import type { ReactNode } from "react";

import { CmsProvider } from "@azone/cms";
import { buildMetadata, buildViewport, organizationJsonLd } from "@azone/seo";
import { ScrollMemory, ScrollToTop, WhatsAppFab } from "@azone/ui";

import { BRAND, whatsappUrl } from "@/constants/brand";
import { CMS_SITE, SEO } from "@/constants/seo";
import "@/styles/globals.css";

const body = Jost({
  subsets: ["latin"],
  variable: "--font-elfia",
  display: "swap",
});

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-elfia-display",
  display: "swap",
});

export const metadata: Metadata = buildMetadata(SEO);
export const viewport: Viewport = buildViewport(SEO);

const jsonLd = organizationJsonLd({
  seo: SEO,
  type: "Brand",
  logo: "/logo.png",
  sameAs: [BRAND.socials.tiktok, BRAND.socials.instagram],
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY" className={`${body.variable} ${display.variable}`}>
      <body>
        {/* Refresh starts at the top; Back keeps your place. See ScrollMemory. */}
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <CmsProvider config={{ site: CMS_SITE }}>{children}</CmsProvider>
        <ScrollMemory />
        <WhatsAppFab href={whatsappUrl()} />
        <ScrollToTop />
      </body>
    </html>
  );
}
