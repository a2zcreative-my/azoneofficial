import type { Metadata } from "next";
import type { ReactNode } from "react";

/* v1.27.0 — "Admin Portal — A2Z CREATIVE MARKETING" in the browser tab: the
   company half comes from the root layout's title template, so only the
   surface name belongs here. */
export const metadata: Metadata = {
  title: "Admin Portal",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
