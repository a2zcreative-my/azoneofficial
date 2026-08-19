import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.27.0 — "Sign in — A2Z CREATIVE MARKETING" in the browser tab (the
   company half comes from the root layout's title template). "Sign in"
   matches the button and heading the page actually shows. */
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
