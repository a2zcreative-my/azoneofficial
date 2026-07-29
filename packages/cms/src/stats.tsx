"use client";

import { useEffect, useState } from "react";

import { useCms } from "./config";

export interface Statistic {
  value: string;
  label: string;
}

/**
 * Statistics published from the CMS (Admin → Content, key `stats.items`, a
 * JSON array of {value,label}). Renders nothing until real numbers exist —
 * deliberately: placeholder counters previously rendered as "0+ / 0 / 0x",
 * which reads as an agency with no track record. Editors add figures when
 * they have them; no code change required.
 */
export function useStatistics(): Statistic[] | null {
  const { site, apiBase } = useCms();
  const [stats, setStats] = useState<Statistic[] | null>(null);

  useEffect(() => {
    void fetch(
      `${apiBase}/content-public?site=${encodeURIComponent(site)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { content?: { key: string; value: string }[] } | null) => {
        const row = data?.content?.find((c) => c.key === "stats.items");
        if (!row) return setStats([]);
        try {
          const parsed: unknown = JSON.parse(row.value);
          const list = Array.isArray(parsed) ? parsed : JSON.parse(String(parsed));
          setStats(
            (Array.isArray(list) ? list : [])
              .filter(
                (s): s is Statistic =>
                  !!s && typeof s.value === "string" && typeof s.label === "string",
              )
              .filter((s) => s.value.trim() !== "" && !/^0[+x]?$/.test(s.value.trim())),
          );
        } catch {
          setStats([]);
        }
      })
      .catch(() => setStats([]));
  }, [site, apiBase]);

  return stats;
}
