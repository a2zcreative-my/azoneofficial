import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PortalProvider } from "@/components/portal/portal-provider";
import { PortalShell } from "@/components/portal/portal-shell";

/* v1.27.0 — the root layout's title template is `%s — ${SITE_CONFIG.name}`
   and SITE_CONFIG.name is now A2Z CREATIVE MARKETING, so this segment must
   carry ONLY the surface name: the browser tab reads
   "Staff Portal — A2Z CREATIVE MARKETING". Repeating the company here would
   print it twice. */
export const metadata: Metadata = {
  title: "Staff Portal",
  robots: { index: false, follow: false },
};

/**
 * v1.181.0 (P1.1) — THE PERSISTENT SHELL LIVES HERE NOW.
 *
 * It used to return `children` untouched, because there was only ever one
 * page underneath it and that page drew its own chrome. P1 needs the chrome
 * to survive a change of module, and a route's page cannot be handed props
 * by a layout — so the provider and the shell moved up here, and the page
 * below is only ever the module.
 *
 * This file stays a SERVER component: `metadata` cannot be exported from a
 * client one, and from P1.2 every route pays for its own real <title> the
 * same way. The two components it renders are client components, and
 * `children` is passed straight through to the shell, which puts it in
 * <main>.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PortalProvider>
      <PortalShell>{children}</PortalShell>
    </PortalProvider>
  );
}
