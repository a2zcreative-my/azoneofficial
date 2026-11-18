import type { Metadata } from "next";

import { HomePage } from "@/components/landing/home-page";
import { HOME_COPY } from "@/constants/home-copy";

/* Website restructure (18-11-2026, unreleased) - the homepage on the owner's brief (18-11-2026): six sections on
   the original A2Z identity. The previous homepage's components are kept in
   components/home/ (unused) so this is one import to undo. */
const t = HOME_COPY.en.meta;

export const metadata: Metadata = {
  title: { absolute: t.title },
  description: t.description,
  alternates: {
    canonical: "/",
    languages: { "en-MY": "/", "ms-MY": "/ms", "x-default": "/" },
  },
  openGraph: { title: t.title, description: t.description, url: "/", locale: "en_MY", alternateLocale: ["ms_MY"] },
};

export default function Page() {
  return <HomePage lang="en" />;
}
