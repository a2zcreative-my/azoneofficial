import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.389.0 - the public staff portfolio. Every /portfolio/<name> address is served this one page
   (public/_redirects rewrites it here, status 200); the page reads the name from the address and
   asks the API for that person's PUBLISHED portfolio. A draft, an unpublished portfolio or
   someone who has left is answered exactly like an address that never existed. */
export const metadata: Metadata = {
  title: "Staff Portfolio",
  description: "Meet the A2Z Creative Marketing team: their work, their expertise and how to reach them.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
