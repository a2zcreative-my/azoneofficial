"use client";

/* v1.348.0 (the CEO, 17-11-2026) - RETIRED. This page drew a read-only copy of
   the BUILT-IN permission defaults; since v1.237.0 the matrix the system
   actually enforces is the one saved in portal Users → Roles & Permissions, so
   this copy could show the wrong answer. Old links land there instead. */

import { useEffect } from "react";
import { PortalSkeleton } from "@/components/portal/portal-skeleton";

export default function RetiredPermissionsPage() {
  useEffect(() => { window.location.replace("/portal?tab=Users&view=roles"); }, []);
  /* skeleton: the page shape while the redirect is on its way */
  return <PortalSkeleton />;
}
