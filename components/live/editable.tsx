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

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function loadContent(): Promise<Record<string, string>> {
  if (cache) return cache;
  inflight ??= fetch("/api/v1/content-public")
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
      cache = map;
      return map;
    })
    .catch(() => {
      cache = {};
      return {};
    });
  return inflight;
}

export function Editable({
  k,
  fallback,
}: {
  k: string;
  fallback: ReactNode;
}) {
  const [override, setOverride] = useState<string | null>(cache?.[k] ?? null);

  useEffect(() => {
    void loadContent().then((map) => {
      if (typeof map[k] === "string") setOverride(map[k]);
    });
  }, [k]);

  return <>{override ?? fallback}</>;
}
