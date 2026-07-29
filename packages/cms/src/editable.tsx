"use client";

/**
 * <Editable k="home.hero.headline" fallback="..." />
 * Renders the site_content value for the key if one exists in D1,
 * otherwise the static fallback. One shared fetch per page load,
 * cached at module level. If the API is unreachable, fallbacks render —
 * the static site never breaks.
 *
 * Editors set values in Admin → Content using these exact keys.
 */

import { useEffect, useState, type ReactNode } from "react";

import { useCms } from "./config";

// Cached per tenant so two apps in one dev session cannot cross-contaminate
const cache = new Map<string, Record<string, string>>();
const inflight = new Map<string, Promise<Record<string, string>>>();

async function loadContent(
  apiBase: string,
  site: string,
): Promise<Record<string, string>> {
  const cached = cache.get(site);
  if (cached) return cached;
  const existing = inflight.get(site);
  if (existing) return existing;
  const request = fetch(`${apiBase}/content-public?site=${encodeURIComponent(site)}`)
    .then((r) => (r.ok ? r.json() : { content: [] }))
    .then((data: { content: { key: string; value: string }[] }) => {
      const map: Record<string, string> = {};
      for (const row of data.content ?? []) {
        try {
          const parsed: unknown = JSON.parse(row.value);
          map[row.key] = typeof parsed === "string" ? parsed : row.value;
        } catch {
          map[row.key] = row.value;
        }
      }
      cache.set(site, map);
      return map;
    })
    .catch(() => {
      cache.set(site, {});
      return {};
    });
  inflight.set(site, request);
  return request;
}

export function Editable({
  k,
  fallback,
}: {
  k: string;
  fallback: ReactNode;
}) {
  const { site, apiBase } = useCms();
  const [override, setOverride] = useState<string | null>(
    cache.get(site)?.[k] ?? null,
  );

  useEffect(() => {
    void loadContent(apiBase, site).then((map) => {
      if (typeof map[k] === "string") setOverride(map[k]);
    });
  }, [k, apiBase, site]);

  return <>{override ?? fallback}</>;
}
