import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.369.0 - the public A2Z Business Growth Check (/apply/business). A
   shareable page: no sign-in, no portal chrome, no account. */
export const metadata: Metadata = {
  title: "A2Z Business Growth Check - Free First Review",
  description: "Kenal pasti cabaran bisnes anda - semakan awal PERCUMA oleh A2Z Creative Marketing. Tell us your challenges and your 90-day goal; a paid service is never required.",
  alternates: { canonical: "/apply/business" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
