import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.351.0 - the public Partner Interest Application (/apply/partner). A
   shareable recruitment page: no sign-in, no portal chrome, no account. */
export const metadata: Metadata = {
  title: "Partner Interest Application",
  description: "Interested in referring potential customers to A2Z? Tell us about your network and referral approach. An independent referral opportunity - not an employment application.",
  alternates: { canonical: "/apply/partner" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
