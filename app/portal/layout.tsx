import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.27.0 — the root layout's title template is `%s — ${SITE_CONFIG.name}`
   and SITE_CONFIG.name is now A2Z CREATIVE MARKETING, so this segment must
   carry ONLY the surface name: the browser tab reads
   "Staff Portal — A2Z CREATIVE MARKETING". Repeating the company here would
   print it twice. */
export const metadata: Metadata = {
  title: "Staff Portal",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
