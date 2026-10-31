import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.238.0 - a single-use link page: never indexed, never followed, and no
   referrer leaves it. */
export const metadata: Metadata = {
  title: "Set password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
