"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Every app on the shared API declares which tenant it is. The Worker scopes
 * all CMS reads and writes by this key, so azoneofficial.com and elfia.com.my
 * can share one database and one deployment without leaking content into each
 * other.
 */
export interface CmsConfig {
  /** Tenant key, e.g. "azoneofficial" or "elfia". */
  site: string;
  /** API base path. Same-origin by default via the Worker route. */
  apiBase?: string;
}

const CmsContext = createContext<CmsConfig>({ site: "azoneofficial" });

export function CmsProvider({
  config,
  children,
}: {
  config: CmsConfig;
  children: ReactNode;
}) {
  return <CmsContext.Provider value={config}>{children}</CmsContext.Provider>;
}

export function useCms(): Required<CmsConfig> {
  const cfg = useContext(CmsContext);
  return { site: cfg.site, apiBase: cfg.apiBase ?? "/api/v1" };
}
