import type { Metadata } from "next";

import { HomePage } from "@/components/landing/home-page";
import { HOME_COPY } from "@/constants/home-copy";

/* Website restructure (18-11-2026, unreleased) - the homepage in Bahasa Melayu, a real page at /ms (not the
   runtime swap of lang-runtime.tsx), so the BM version can be indexed and
   is linked to the English one by hreflang. */
const t = HOME_COPY.ms.meta;

export const metadata: Metadata = {
  title: { absolute: t.title },
  description: t.description,
  alternates: {
    canonical: "/ms",
    languages: { "en-MY": "/", "ms-MY": "/ms", "x-default": "/" },
  },
  openGraph: { title: t.title, description: t.description, url: "/ms", locale: "ms_MY", alternateLocale: ["en_MY"] },
};

export default function Page() {
  return <HomePage lang="ms" />;
}
